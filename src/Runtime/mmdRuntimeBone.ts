import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Nullable } from "@babylonjs/core/types";

import type { MmdModelMetadata } from "@/Loader/mmdModelMetadata";
import { PmxObject } from "@/Loader/Parser/pmxObject";

import type { AppendTransformSolver } from "./appendTransformSolver";
import type { IkSolver } from "./ikSolver";
import type { IMmdRuntimeLinkedBone } from "./IMmdRuntimeLinkedBone";

/**
 * Bone for MMD runtime
 *
 * For mmd runtime, it is necessary to override the bone system because it has a different implementation than the usual matrix update method
 *
 * Which requires the mmd runtime bone, which is the wrapper of the babylon.js bone
 */
export interface IMmdRuntimeBone {
    /**
     * The Babylon.js bone
     */
    readonly linkedBone: IMmdRuntimeLinkedBone;

    /**
     * Name of the bone
     */
    readonly name: string;

    /**
     * Parent bone
     */
    readonly parentBone: Nullable<IMmdRuntimeBone>;

    /**
     * Child bones
     */
    readonly childBones: readonly IMmdRuntimeBone[];

    /**
     * Transform order
     */
    readonly transformOrder: number;

    /**
     * Bone flag
     *
     * @see PmxObject.Bone.Flag
     */
    readonly flag: number;

    /**
     * Whether the bone transform is applied after physics
     */
    readonly transformAfterPhysics: boolean;

    /**
     * Get ik solver index
     *
     * If the bone does not have an ik solver, it will return -1
     */
    get ikSolverIndex(): number;
}

export class MmdRuntimeBone implements IMmdRuntimeBone {
    public readonly linkedBone: IMmdRuntimeLinkedBone;

    public readonly name: string;
    public parentBone: Nullable<MmdRuntimeBone>;
    public readonly childBones: MmdRuntimeBone[];

    public readonly transformOrder: number;
    public readonly flag: number;
    public readonly transformAfterPhysics: boolean;

    public appendTransformSolver: Nullable<AppendTransformSolver>;
    public ikSolver: Nullable<IkSolver>;

    public readonly morphPositionOffset: Vector3;
    public readonly morphRotationOffset: Quaternion;

    public ikRotation: Nullable<Quaternion>;

    public readonly localMatrix: Matrix;
    public readonly worldMatrix: Matrix;

    public getAnimatedPositionToRef: (target: Vector3) => Vector3;
    public getAnimatedRotationToRef: (target: Quaternion) => Quaternion;
    public getAnimationPositionOffsetToRef: (target: Vector3) => Vector3;
    // public getAnimationRotationOffsetToRef: (target: Quaternion) => Quaternion;

    public constructor(babylonBone: IMmdRuntimeLinkedBone, boneMetadata: MmdModelMetadata.Bone) {
        this.linkedBone = babylonBone;

        this.name = boneMetadata.name;
        this.parentBone = null;
        this.childBones = [];

        this.transformOrder = boneMetadata.transformOrder;
        this.flag = boneMetadata.flag;
        this.transformAfterPhysics = (boneMetadata.flag & PmxObject.Bone.Flag.TransformAfterPhysics) !== 0;

        this.appendTransformSolver = null;
        this.ikSolver = null;

        this.morphPositionOffset = Vector3.Zero();
        this.morphRotationOffset = Quaternion.Identity();

        this.ikRotation = null;

        this.localMatrix = Matrix.Identity();
        this.worldMatrix = babylonBone.getFinalMatrix();

        this.getAnimatedPositionToRef = this._getAnimatedPositionToRef;
        this.getAnimatedRotationToRef = this._getAnimatedRotationToRef;
        this.getAnimationPositionOffsetToRef = this._getAnimationPositionOffsetToRef;
        // this.getAnimationRotationOffsetToRef = this._getAnimationRotationOffsetToRef;
    }

    private _getAnimatedPositionWithMorphToRef(target: Vector3): Vector3 {
        target.copyFrom(this.linkedBone.position);
        return target.addInPlace(this.morphPositionOffset);
    }

    private _getAnimatedPositionToRef(target: Vector3): Vector3 {
        target.copyFrom(this.linkedBone.position);
        return target;
    }

    private _getAnimatedRotationToRef(target: Quaternion): Quaternion {
        return target.copyFrom(this.linkedBone.rotationQuaternion);
    }

    private _getAnimatedRotationWithMorphToRef(target: Quaternion): Quaternion {
        target.copyFrom(this.linkedBone.rotationQuaternion);
        return target.multiplyInPlace(this.morphRotationOffset);
    }

    private static readonly _TempVector3 = new Vector3();

    private _getAnimationPositionOffsetToRef(target: Vector3): Vector3 {
        target.copyFrom(this.linkedBone.position);
        this.linkedBone.getRestMatrix().getTranslationToRef(MmdRuntimeBone._TempVector3);
        return target.subtractInPlace(MmdRuntimeBone._TempVector3);
    }

    private _getAnimationPositionOffsetWithMorphToRef(target: Vector3): Vector3 {
        target.copyFrom(this.linkedBone.position);
        target.addInPlace(this.morphPositionOffset);
        this.linkedBone.getRestMatrix().getTranslationToRef(MmdRuntimeBone._TempVector3);
        return target.subtractInPlace(MmdRuntimeBone._TempVector3);
    }

    // a: rest quaternion
    // b: animation quaternion
    // c: animated quaternion

    // a * b = c

    // to get b from a and c:
    // a^-1 * c = b

    // private static readonly _TempQuaternion = new Quaternion();

    // private _getAnimationRotationOffsetToRef(target: Quaternion): Quaternion {
    //     target.copyFrom(this.babylonBone.rotationQuaternion);
    //     Quaternion.FromRotationMatrixToRef(this.babylonBone.getRestMatrix(), MmdRuntimeBone._TempQuaternion).invertInPlace();
    //     return MmdRuntimeBone._TempQuaternion.multiplyInPlace(target);
    // }

    // private _getAnimationRotationOffsetWithMorphToRef(target: Quaternion): Quaternion {
    //     target.copyFrom(this.babylonBone.rotationQuaternion);
    //     target.multiplyInPlace(this.morphRotationOffset);
    //     Quaternion.FromRotationMatrixToRef(this.babylonBone.getRestMatrix(), MmdRuntimeBone._TempQuaternion).invertInPlace();
    //     return MmdRuntimeBone._TempQuaternion.multiplyInPlace(target);
    // }

    public enableMorph(): void {
        this.getAnimatedPositionToRef = this._getAnimatedPositionWithMorphToRef;
        this.getAnimatedRotationToRef = this._getAnimatedRotationWithMorphToRef;

        this.getAnimationPositionOffsetToRef = this._getAnimationPositionOffsetWithMorphToRef;
        // this.getAnimationRotationOffsetToRef = this._getAnimationRotationOffsetWithMorphToRef;
    }

    public disableMorph(): void {
        this.getAnimatedPositionToRef = this._getAnimatedPositionToRef;
        this.getAnimatedRotationToRef = this._getAnimatedRotationToRef;

        this.getAnimationPositionOffsetToRef = this._getAnimationPositionOffsetToRef;
        // this.getAnimationRotationOffsetToRef = this._getAnimationRotationOffsetToRef;
    }

    private static readonly _TempRotation = Quaternion.Identity();
    private static readonly _TempPosition = Vector3.Zero();

    public updateLocalMatrix(): void {
        const rotation = this.getAnimatedRotationToRef(MmdRuntimeBone._TempRotation);
        if (this.ikRotation !== null) {
            this.ikRotation.multiplyToRef(rotation, rotation);
        }

        const position = this.getAnimatedPositionToRef(MmdRuntimeBone._TempPosition);

        if (this.appendTransformSolver !== null) {
            if (this.appendTransformSolver.affectRotation) {
                rotation.multiplyInPlace(this.appendTransformSolver.appendRotationOffset);
            }
            if (this.appendTransformSolver.affectPosition) {
                position.addInPlace(this.appendTransformSolver.appendPositionOffset);
            }
        }

        Matrix.ComposeToRef(
            this.linkedBone.scaling,
            rotation,
            position,
            this.localMatrix
        );
    }

    private static readonly _Stack: MmdRuntimeBone[] = [];

    public updateWorldMatrix(): void {
        const stack = MmdRuntimeBone._Stack;
        stack.length = 0;
        stack.push(this);

        while (stack.length > 0) {
            const bone = stack.pop()!;

            const parentBone = bone.parentBone;
            if (parentBone !== null) {
                bone.localMatrix.multiplyToRef(parentBone.worldMatrix, bone.worldMatrix);
            } else {
                bone.worldMatrix.copyFrom(bone.localMatrix);
            }

            const childrenBones = bone.childBones;
            for (let i = 0, l = childrenBones.length; i < l; ++i) {
                stack.push(childrenBones[i]);
            }
        }
    }

    /**
     * Get ik solver index
     *
     * If the bone does not have an ik solver, it will return -1
     */
    public get ikSolverIndex(): number {
        return this.ikSolver !== null ? this.ikSolver.index : -1;
    }
}
