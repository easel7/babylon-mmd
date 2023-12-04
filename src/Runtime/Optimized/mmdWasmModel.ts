import type { Bone } from "@babylonjs/core/Bones/bone";
import type { Material } from "@babylonjs/core/Materials/material";
import { Space } from "@babylonjs/core/Maths/math.axis";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Observable } from "@babylonjs/core/Misc/observable";
import type { Nullable } from "@babylonjs/core/types";

import type { IMmdBindableModelAnimation } from "../Animation/IMmdBindableAnimation";
import type { IMmdRuntimeModelAnimation } from "../Animation/IMmdRuntimeAnimation";
import type { MmdCompositeRuntimeModelAnimation } from "../Animation/mmdCompositeRuntimeModelAnimation";
import type { MmdRuntimeModelAnimation } from "../Animation/mmdRuntimeModelAnimation";
import type { MmdRuntimeModelAnimationGroup } from "../Animation/mmdRuntimeModelAnimationGroup";
import type { ILogger } from "../ILogger";
import type { IMmdMaterialProxyConstructor } from "../IMmdMaterialProxy";
import type { IMmdModel } from "../IMmdModel";
import type { IMmdRuntimeBone } from "../IMmdRuntimeBone";
import type { IMmdLinkedBoneContainer } from "../IMmdRuntimeLinkedBone";
import type { MmdModelNode, RuntimeMmdModelNode } from "../mmdModelNode";
import { MmdMorphController } from "../mmdMorphController";
import type { MmdRuntimeBone } from "../mmdRuntimeBone";

type RuntimeModelAnimation = MmdRuntimeModelAnimation | MmdRuntimeModelAnimationGroup | MmdCompositeRuntimeModelAnimation | IMmdRuntimeModelAnimation;

/**
 * MmdWasmModel is a class that controls the `MmdMesh` to animate the Mesh with MMD Wasm Runtime
 *
 * The mesh that instantiates `MmdWasmModel` ignores some original implementations of Babylon.js and follows the MMD specifications
 *
 * The biggest difference is that the methods that get the absolute transform of `mesh.skeleton.bones` no longer work properly and can only get absolute transform through `mmdModel.worldTransformMatrices`
 *
 * Final matrix is guaranteed to be updated after `MmdWasmModel.afterPhysics()` stage
 */
export class MmdWasmModel implements IMmdModel {
    /**
     * The root node of this model
     */
    public readonly node: RuntimeMmdModelNode;

    /**
     * The skeleton of this model
     *
     * This can be a instance of `Skeleton`, or if you are using a humanoid model, it will be referencing a virtualized bone tree
     *
     * So MmdWasmModel.mesh.skeleton is not always equal to MmdWasmModel.skeleton
     */
    public readonly skeleton: IMmdLinkedBoneContainer;

    /**
     * The array of final transform matrices of bones (ie. the matrix sent to shaders)
     */
    public readonly worldTransformMatrices: Float32Array;

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
     * The `MmdMorphController` not only wrapper of `MorphTargetManager` but also controls the CPU bound morphs (bone, material, group)
     */
    public readonly morph: MmdMorphController;

    private readonly _logger: ILogger;

    private readonly _sortedRuntimeBones: readonly MmdRuntimeBone[];

    public readonly onCurrentAnimationChangedObservable: Observable<Nullable<RuntimeModelAnimation>>;
    private readonly _animations: RuntimeModelAnimation[];
    private readonly _animationIndexMap: Map<string, number>;

    private _currentAnimation: Nullable<RuntimeModelAnimation>;

    /**
     * Create a MmdWasmModel
     * @param mmdModelNode Transform node that able to instantiate `MmdWasmModel`
     * @param skeleton The virtualized bone container of the mesh
     * @param materialProxyConstructor The constructor of `IMmdMaterialProxy`
     * @param buildPhysics Whether to build physics
     * @param logger Logger
     */
    public constructor(
        mmdModelNode: MmdModelNode,
        skeleton: IMmdLinkedBoneContainer,
        materialProxyConstructor: Nullable<IMmdMaterialProxyConstructor<Material>>,
        buildPhysics: boolean,
        logger: ILogger
    ) {
        this._logger = logger;

        const mmdMetadata = mmdModelNode.metadata;

        const runtimeModelNode = mmdModelNode as unknown as RuntimeMmdModelNode;
        runtimeModelNode.metadata = {
            isRuntimeMmdModel: true,
            header: mmdMetadata.header,
            meshes: mmdMetadata.meshes,
            skeleton: mmdMetadata.skeleton,
            materials: mmdMetadata.materials
        };
        this.node = runtimeModelNode;
        this.skeleton = skeleton;
        this.worldTransformMatrices = new Float32Array(skeleton.bones.length * 16);
        {
            let ikSolverCount = 0;
            const bonesMetadata = mmdMetadata.bones;
            for (let i = 0; i < bonesMetadata.length; ++i) {
                if (bonesMetadata[i].ik !== undefined) ikSolverCount += 1;
            }
            this.ikSolverStates = new Uint8Array(ikSolverCount).fill(1);
        }

        // If you are not using MMD Runtime, you need to update the world matrix once. it could be waste of performance
        skeleton.prepare();

        this._disableSkeletonWorldMatrixUpdate(skeleton);

        this.runtimeBones = [];

        this._sortedRuntimeBones = [];

        this.morph = new MmdMorphController(
            null,
            mmdMetadata.materials,
            materialProxyConstructor,
            mmdMetadata.morphs,
            logger
        );

        buildPhysics;

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
        (this.node as any).metadata = null;
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
     * Before the physics stage, update animations and run MMD runtime solvers
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
        // wasm side computes the world matrix of the bones
    }

    /**
     * After the physics stage, run MMD runtime solvers
     *
     * This method must be called after the physics stage
     */
    public afterPhysics(): void {
        // wasm side computes the world matrix of the bones
        this.node.metadata.skeleton._markAsDirty();
    }

    private _originalComputeTransformMatrices: Nullable<(targetMatrix: Float32Array, initialSkinMatrix: Nullable<Matrix>) => void> = null;

    private _disableSkeletonWorldMatrixUpdate(skeleton: IMmdLinkedBoneContainer): void {
        if (this._originalComputeTransformMatrices !== null) return;
        this._originalComputeTransformMatrices = (skeleton as any)._computeTransformMatrices;

        (skeleton as any)._computeTransformMatrices = function(targetMatrix: Float32Array, _initialSkinMatrix: Nullable<Matrix>): void {
            this.onBeforeComputeObservable.notifyObservers(this);

            for (let index = 0; index < this.bones.length; index++) {
                const bone = this.bones[index] as Bone;
                bone._childUpdateId += 1;

                if (bone._index !== -1) {
                    const mappedIndex = bone._index === null ? index : bone._index;
                    bone.getAbsoluteInverseBindMatrix().multiplyToArray(bone.getFinalMatrix(), targetMatrix, mappedIndex * 16);
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
        this.node.metadata.skeleton._markAsDirty();
    }
}
