import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Material } from "@babylonjs/core/Materials/material";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Nullable } from "@babylonjs/core/types";

import type { MmdModelMetadata } from "@/Loader/mmdModelMetadata";

import type { IMmdBindableModelAnimation } from "../Animation/IMmdBindableAnimation";
import type { IMmdRuntimeModelAnimation } from "../Animation/IMmdRuntimeAnimation";
import type { MmdCompositeRuntimeModelAnimation } from "../Animation/mmdCompositeRuntimeModelAnimation";
import type { MmdRuntimeModelAnimation } from "../Animation/mmdRuntimeModelAnimation";
import type { MmdRuntimeModelAnimationGroup } from "../Animation/mmdRuntimeModelAnimationGroup";
import type { ILogger } from "../ILogger";
import type { IMmdMaterialProxyConstructor } from "../IMmdMaterialProxy";
import type { IMmdModel } from "../IMmdModel";
import type { IMmdRuntimeBone } from "../IMmdRuntimeBone";
import type { IMmdLinkedBoneContainer, IMmdRuntimeLinkedBone } from "../IMmdRuntimeLinkedBone";
import type { MmdSkinnedMesh, RuntimeMmdMesh } from "../mmdMesh";
import { MmdWasmMorphController } from "./mmdWasmMorphController";
import { MmdWasmRuntimeBone } from "./mmdWasmRuntimeBone";
import type { MmdRuntime } from "./wasm";

type RuntimeModelAnimation = MmdRuntimeModelAnimation | MmdRuntimeModelAnimationGroup | MmdCompositeRuntimeModelAnimation | IMmdRuntimeModelAnimation;

/**
 * MmdWasmModel is a class that controls the `MmdSkinnedMesh` to animate the Mesh with MMD Wasm Runtime
 *
 * The mesh that instantiates `MmdWasmModel` ignores some original implementations of Babylon.js and follows the MMD specifications
 *
 * The biggest difference is that the methods that get the absolute transform of `mesh.skeleton.bones` no longer work properly and can only get absolute transform through `mmdModel.worldTransformMatrices`
 *
 * Final matrix is guaranteed to be updated after `MmdWasmModel.afterPhysics()` stage
 */
export class MmdWasmModel implements IMmdModel {
    /**
     * Pointer to wasm side MmdModel
     */
    public readonly ptr: number;

    /**
     * The root mesh of this model
     */
    public readonly mesh: RuntimeMmdMesh;

    /**
     * The skeleton of this model
     *
     * This can be a instance of `Skeleton`, or if you are using a humanoid model, it will be referencing a virtualized bone tree
     *
     * So MmdWasmModel.metadata.skeleton is not always equal to MmdWasmModel.skeleton
     */
    public readonly skeleton: IMmdLinkedBoneContainer;

    /**
     * The array of final transform matrices of bones (ie. the matrix sent to shaders)
     */
    public readonly worldTransformMatrices: Float32Array;

    /**
     * Wasm side bone animation states. this value is automatically synchronized with `MmdWasmModel.skeleton` on `MmdWasmModel.beforePhysics()` stage
     *
     * repr: [..., positionX, positionY, positionZ, rotationX, rotationY, rotationZ, rotationW, scaleX, scaleY, scaleZ, ...]
     */
    public readonly boneAnimationStates: Float32Array;

    /**
     * Uint8Array that stores the state of IK solvers
     *
     * If `ikSolverState[MmdModel.runtimeBones[i].ikSolverIndex]` is 0, IK solver of `MmdModel.runtimeBones[i]` is disabled and vice versa
     */
    public readonly ikSolverStates: Uint8Array;

    /**
     * Runtime bones of this model
     *
     * You can get the final transform matrix of a bone by `MmdModel.runtimeBones[i].getFinalMatrixToRef()`
     */
    public readonly runtimeBones: readonly IMmdRuntimeBone[];

    /**
     * The morph controller of this model
     *
     * The `MmdWasmMorphController` not only wrapper of `MorphTargetManager` but also controls the CPU bound morphs (bone, material, group)
     */
    public readonly morph: MmdWasmMorphController;

    private readonly _logger: ILogger;

    private readonly _sortedRuntimeBones: readonly MmdWasmRuntimeBone[];

    public readonly onCurrentAnimationChangedObservable: Observable<Nullable<RuntimeModelAnimation>>;
    private readonly _animations: RuntimeModelAnimation[];
    private readonly _animationIndexMap: Map<string, number>;

    private _currentAnimation: Nullable<RuntimeModelAnimation>;

    /**
     * Create a MmdWasmModel
     * @param wasmRuntime MMD WASM runtime
     * @param ptr Pointer to wasm side MmdModel
     * @param mmdSkinnedMesh Mesh that able to instantiate `MmdWasmModel`
     * @param skeleton The virtualized bone container of the mesh
     * @param materialProxyConstructor The constructor of `IMmdMaterialProxy`
     * @param wasmMorphIndexMap Mmd morph to WASM morph index map
     * @param logger Logger
     */
    public constructor(
        wasmRuntime: MmdRuntime,
        ptr: number,
        mmdSkinnedMesh: MmdSkinnedMesh,
        skeleton: IMmdLinkedBoneContainer,
        materialProxyConstructor: Nullable<IMmdMaterialProxyConstructor<Material>>,
        wasmMorphIndexMap: Int32Array,
        logger: ILogger
    ) {
        this._logger = logger;

        const mmdMetadata = mmdSkinnedMesh.metadata;

        const runtimeModelNode = mmdSkinnedMesh as unknown as RuntimeMmdMesh;
        runtimeModelNode.metadata = {
            isRuntimeMmdModel: true,
            header: mmdMetadata.header,
            meshes: mmdMetadata.meshes,
            materials: mmdMetadata.materials,
            skeleton: mmdMetadata.skeleton
        };
        this.ptr = ptr;
        this.mesh = runtimeModelNode;
        this.skeleton = skeleton;

        const worldTransformMatrices = wasmRuntime.getBoneWorldMatrixArena(ptr);
        const boneAnimationStates = wasmRuntime.getAnimationArena(ptr);
        const ikSolverStates = wasmRuntime.getAnimationIkSolverStateArena(ptr);
        const morphWeights = wasmRuntime.getAnimationMorphArena(ptr);

        this.worldTransformMatrices = worldTransformMatrices;
        this.boneAnimationStates = boneAnimationStates;
        this.ikSolverStates = ikSolverStates;

        // If you are not using MMD Runtime, you need to update the world matrix once. it could be waste of performance
        skeleton.prepare();

        this._disableSkeletonWorldMatrixUpdate(skeleton);

        const runtimeBones = this.runtimeBones = this._buildRuntimeSkeleton(
            skeleton.bones,
            mmdMetadata.bones,
            worldTransformMatrices,
            wasmRuntime,
            ptr
        );

        const sortedBones = this._sortedRuntimeBones = [...runtimeBones];
        // sort must be stable (require ES2019)
        sortedBones.sort((a, b) => {
            return a.transformOrder - b.transformOrder;
        });

        this.morph = new MmdWasmMorphController(
            morphWeights,
            wasmMorphIndexMap,
            mmdMetadata.materials,
            materialProxyConstructor,
            mmdMetadata.morphs,
            logger
        );

        this.onCurrentAnimationChangedObservable = new Observable<Nullable<IMmdRuntimeModelAnimation>>();
        this._animations = [];
        this._animationIndexMap = new Map();

        this._currentAnimation = null;
    }

    /**
     * Dispose this model
     *
     * Restore the original bone matrix update behavior
     *
     * Dispose the physics resources if the physics is enabled
     */
    public dispose(): void {
        this._enableSkeletonWorldMatrixUpdate();
        this.onCurrentAnimationChangedObservable.clear();
        (this.mesh as any).metadata = null;
    }

    /**
     * Get the sorted bones of this model
     *
     * The bones are sorted by `transformOrder`
     */
    public get sortedRuntimeBones(): readonly IMmdRuntimeBone[] {
        return this._sortedRuntimeBones;
    }

    /**
     * Add an animation to this model
     * @param animation MMD animation or MMD model animation group to add
     * @param retargetingMap Model bone name to animation bone name map
     */
    public addAnimation(
        animation: IMmdBindableModelAnimation,
        retargetingMap?: { [key: string]: string }
    ): void {
        let runtimeAnimation: RuntimeModelAnimation;
        if ((animation as IMmdBindableModelAnimation).createRuntimeModelAnimation !== undefined) {
            runtimeAnimation = animation.createRuntimeModelAnimation(this, retargetingMap, this._logger);
        } else {
            throw new Error("animation is not MmdAnimation or MmdModelAnimationGroup or MmdCompositeAnimation. are you missing import \"babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimation\" or \"babylon-mmd/esm/Runtime/Animation/mmdRuntimeModelAnimationGroup\" or \"babylon-mmd/esm/Runtime/Animation/mmdCompositeRuntimeModelAnimation\"?");
        }
        this._animationIndexMap.set(animation.name, this._animations.length);
        this._animations.push(runtimeAnimation);
    }

    /**
     * Remove an animation from this model
     *
     * If index is out of range, do nothing
     * @param index The index of the animation to remove
     */
    public removeAnimation(index: number): void {
        const animation = this._animations[index];
        if (this._currentAnimation === animation) {
            this._currentAnimation = null;
            this._resetPose();
            this.onCurrentAnimationChangedObservable.notifyObservers(null);
        }

        this._animationIndexMap.delete(animation.animation.name);
        this._animations.splice(index, 1);
        (animation as IMmdRuntimeModelAnimation).dispose?.();
    }

    /**
     * Set the current animation of this model
     * @param name The name of the animation to set
     * @throws {Error} if the animation is not found
     */
    public setAnimation(name: Nullable<string>): void {
        if (name === null) {
            if (this._currentAnimation !== null) {
                this._currentAnimation = null;
                this._resetPose();
                this.onCurrentAnimationChangedObservable.notifyObservers(null);
            }
            return;
        }

        const index = this._animationIndexMap.get(name);
        if (index === undefined) {
            throw new Error(`Animation '${name}' is not found.`);
        }

        if (this._currentAnimation !== null) this._resetPose();
        const animation = this._currentAnimation = this._animations[index];
        animation.induceMaterialRecompile(this._logger);
        this.onCurrentAnimationChangedObservable.notifyObservers(animation);
    }

    /**
     * Get the animations of this model
     */
    public get runtimeAnimations(): readonly RuntimeModelAnimation[] {
        return this._animations;
    }

    /**
     * Get the current animation of this model
     */
    public get currentAnimation(): Nullable<RuntimeModelAnimation> {
        return this._currentAnimation;
    }

    /**
     * Reset the morph weights and IK enabled state of this model
     */
    public resetState(): void {
        this.morph.resetMorphWeights();
        this.ikSolverStates.fill(1);
    }

    /**
     * Before the physics stage, update animations
     *
     * mmd solvers are run by wasm runtime
     *
     * This method must be called before the physics stage
     *
     * If frameTime is null, animations are not updated
     * @param frameTime The time elapsed since the last frame in 30fps
     */
    public beforePhysics(frameTime: Nullable<number>): void {
        if (frameTime !== null) {
            if (this._currentAnimation !== null) {
                this._currentAnimation.animate(frameTime);
            }
        }

        this.morph.update();

        const bones = this.skeleton.bones;
        const boneAnimationStates = this.boneAnimationStates;
        for (let i = 0; i < bones.length; ++i) {
            const bone = bones[i];
            const boneAnimationStateIndex = i * 10;
            {
                const { x, y, z } = bone.position;
                boneAnimationStates[boneAnimationStateIndex + 0] = x;
                boneAnimationStates[boneAnimationStateIndex + 1] = y;
                boneAnimationStates[boneAnimationStateIndex + 2] = z;
            }
            {
                const { x, y, z, w } = bone.rotationQuaternion;
                boneAnimationStates[boneAnimationStateIndex + 3] = x;
                boneAnimationStates[boneAnimationStateIndex + 4] = y;
                boneAnimationStates[boneAnimationStateIndex + 5] = z;
                boneAnimationStates[boneAnimationStateIndex + 6] = w;
            }
            {
                const { x, y, z } = bone.scaling;
                boneAnimationStates[boneAnimationStateIndex + 7] = x;
                boneAnimationStates[boneAnimationStateIndex + 8] = y;
                boneAnimationStates[boneAnimationStateIndex + 9] = z;
            }
        }
    }

    /**
     * After the physics stage
     *
     * mmd solvers are run by wasm runtime
     *
     * This method must be called after the physics stage
     */
    public afterPhysics(): void {
        this.mesh.metadata.skeleton._markAsDirty();
    }

    private _buildRuntimeSkeleton(
        bones: IMmdRuntimeLinkedBone[],
        bonesMetadata: readonly MmdModelMetadata.Bone[],
        worldTransformMatrices: Float32Array,
        wasmRuntime: MmdRuntime,
        mmdModelPtr: number
    ): readonly MmdWasmRuntimeBone[] {
        const runtimeBones: MmdWasmRuntimeBone[] = [];

        let ikSolverCount = 0;
        for (let i = 0; i < bonesMetadata.length; ++i) {
            const boneMetadata = bonesMetadata[i];

            let ikSolverIndex = -1;
            if (boneMetadata.ik !== undefined) {
                ikSolverIndex = ikSolverCount;
                ikSolverCount += 1;
            }

            runtimeBones.push(new MmdWasmRuntimeBone(bones[i], boneMetadata, worldTransformMatrices, i, ikSolverIndex, wasmRuntime, mmdModelPtr));
        }

        for (let i = 0; i < bonesMetadata.length; ++i) {
            const boneMetadata = bonesMetadata[i];
            const bone = runtimeBones[i];

            const parentBoneIndex = boneMetadata.parentBoneIndex;
            if (0 <= parentBoneIndex && parentBoneIndex < runtimeBones.length) {
                const parentBone = runtimeBones[parentBoneIndex];
                bone.parentBone = parentBone;
                parentBone.childBones.push(bone);
            }
        }

        return runtimeBones;
    }

    private _originalComputeTransformMatrices: Nullable<(targetMatrix: Float32Array, initialSkinMatrix: Nullable<Matrix>) => void> = null;

    private _disableSkeletonWorldMatrixUpdate(skeleton: IMmdLinkedBoneContainer): void {
        if (this._originalComputeTransformMatrices !== null) return;
        this._originalComputeTransformMatrices = (skeleton as any)._computeTransformMatrices;

        const worldTransformMatrices = this.worldTransformMatrices;

        (globalThis as any).consoleMatrix = (): void => {
            console.log(worldTransformMatrices);
        };

        (skeleton as any)._computeTransformMatrices = function(targetMatrix: Float32Array, _initialSkinMatrix: Nullable<Matrix>): void {
            this.onBeforeComputeObservable.notifyObservers(this);

            for (let index = 0; index < this.bones.length; index++) {
                const bone = this.bones[index] as Bone;
                bone._childUpdateId += 1;

                if (bone._index !== -1) {
                    const mappedIndex = bone._index === null ? index : bone._index;
                    bone.getAbsoluteInverseBindMatrix().multiplyToArray(
                        Matrix.FromArrayToRef(worldTransformMatrices, index * 16, bone.getFinalMatrix()),
                        targetMatrix,
                        mappedIndex * 16
                    );
                }
            }

            this._identity.copyToArray(targetMatrix, this.bones.length * 16);
        };
    }

    private _enableSkeletonWorldMatrixUpdate(): void {
        if (this._originalComputeTransformMatrices === null) return;
        (this.skeleton as any)._computeTransformMatrices = this._originalComputeTransformMatrices;
        this._originalComputeTransformMatrices = null;
    }

    private _resetPose(): void {
        const sortedBones = this._sortedRuntimeBones;

        const position = new Vector3();
        const identityRotation = Quaternion.Identity();

        for (let i = 0; i < sortedBones.length; ++i) {
            const bone = sortedBones[i].linkedBone;
            bone.getRestMatrix().getTranslationToRef(position);

            bone.position = position;
            bone.setRotationQuaternion(identityRotation, Space.LOCAL);
        }
        this.mesh.metadata.skeleton._markAsDirty();
    }
}
