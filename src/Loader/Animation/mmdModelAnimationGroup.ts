import { Animation } from "@babylonjs/core/Animations/animation";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { IAnimationKey } from "@babylonjs/core/Animations/animationKey";
import { AnimationKeyInterpolation } from "@babylonjs/core/Animations/animationKey";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Nullable } from "@babylonjs/core/types";

import type { MmdModel } from "@/Runtime/mmdModel";

import { computeHermiteTangent } from "./Common/computeHermiteTangent";
import type { IMmdAnimation } from "./IMmdAnimation";
import type { MmdAnimation } from "./mmdAnimation";
import type { MmdBoneAnimationTrack, MmdMorphAnimationTrack, MmdMovableBoneAnimationTrack, MmdPropertyAnimationTrack } from "./mmdAnimationTrack";

/**
 * A container type that stores mmd model animations using the `Animation` container in babylon.js
 *
 * It aims to utilize the animation runtime of babylon.js
 */
export class MmdModelAnimationGroup implements IMmdAnimation {
    /**
     * Animation name for identification
     */
    public readonly name: string;

    /**
     * Bone position animation tracks for one `mesh.skeleton`
     */
    public readonly bonePositionAnimations: Animation[];

    /**
     * Bone rotation animation tracks for one `mesh.skeleton`
     */
    public readonly boneRotationAnimations: Animation[];

    /**
     * Morph animation tracks for one `mesh.morphTargetManager`
     */
    public readonly morphAnimations: Animation[];

    /**
     * Property animation track(a.k.a. IK toggle animation) for one `mmdModel`
     */
    public readonly propertyAnimations: Animation[];

    /**
     * Visibility animation track for one `mesh`
     */
    public readonly visibilityAnimation: Nullable<Animation>;

    /**
     * The start frame of this animation
     */
    public readonly startFrame: number;

    /**
     * The end frame of this animation
     */
    public readonly endFrame: number;

    /**
     * Create a unbinded mmd model animation group
     * @param mmdAnimation The mmd animation data
     * @param builder The builder for constructing mmd model animation group
     */
    public constructor(
        mmdAnimation: MmdAnimation,
        builder: new () => IMmdModelAnimationGroupBuilder
    ) {
        const builderInstance = new builder();

        this.name = mmdAnimation.name;

        const moveableBoneTracks = mmdAnimation.moveableBoneTracks;
        const bonePositionAnimations: Animation[] = this.bonePositionAnimations = new Array(moveableBoneTracks.length);
        for (let i = 0; i < moveableBoneTracks.length; ++i) {
            bonePositionAnimations[i] = builderInstance.createBonePositionAnimation(moveableBoneTracks[i]);
        }

        const boneTracks = mmdAnimation.boneTracks;
        const boneRotationAnimations: Animation[] = this.boneRotationAnimations = new Array(boneTracks.length + moveableBoneTracks.length);
        for (let i = 0; i < boneTracks.length; ++i) {
            boneRotationAnimations[i] = builderInstance.createBoneRotationAnimation(boneTracks[i]);
        }
        for (let i = 0; i < moveableBoneTracks.length; ++i) {
            boneRotationAnimations[boneTracks.length + i] = builderInstance.createBoneRotationAnimation(moveableBoneTracks[i]);
        }

        const morphTracks = mmdAnimation.morphTracks;
        const morphAnimations: Animation[] = this.morphAnimations = new Array(morphTracks.length);
        for (let i = 0; i < morphTracks.length; ++i) {
            morphAnimations[i] = builderInstance.createMorphAnimation(morphTracks[i]);
        }

        this.propertyAnimations = builderInstance.createPropertyAnimation(mmdAnimation.propertyTrack);
        this.visibilityAnimation = builderInstance.createVisibilityAnimation(mmdAnimation.propertyTrack);

        this.startFrame = mmdAnimation.startFrame;
        this.endFrame = mmdAnimation.endFrame;
    }

    /**
     * Create a binded mmd model animation group for the given `MmdModel`
     * @param mmdModel The mmd model to bind
     * @returns The binded mmd model animation group
     */
    public createAnimationGroup(mmdModel: MmdModel): AnimationGroup {
        mmdModel;
        throw new Error("Not implemented");
    }
}

/**
 * Mmd model animation builder for constructing mmd model animation group
 */
export interface IMmdModelAnimationGroupBuilder {
    /**
     * Create mmd model bone position animation
     * @param mmdAnimationTrack mmd bone animation track
     * @returns babylon.js animation
     */
    createBonePositionAnimation(mmdAnimationTrack: MmdMovableBoneAnimationTrack): Animation;

    /**
     * Create mmd model bone rotation animation
     * @param mmdAnimationTrack mmd bone animation track
     * @returns babylon.js animation
     */
    createBoneRotationAnimation(mmdAnimationTrack: MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack): Animation;

    /**
     * Create mmd model morph animation
     * @param mmdAnimationTrack mmd morph animation track
     * @returns babylon.js animation
     */
    createMorphAnimation(mmdAnimationTrack: MmdMorphAnimationTrack): Animation;

    /**
     * Create mmd model property animation
     * @param mmdAnimationTrack mmd property animation track
     * @returns babylon.js animations
     */
    createPropertyAnimation(mmdAnimationTrack: MmdPropertyAnimationTrack): Animation[];

    /**
     * Create mmd model visibility animation
     * @param mmdAnimationTrack mmd property animation track
     * @returns babylon.js animation
     */
    createVisibilityAnimation(mmdAnimationTrack: MmdPropertyAnimationTrack): Nullable<Animation>;
}

/**
 * Use hermite interpolation for import animation bezier curve parameter
 *
 * This has some loss of curve shape, but it converts animations reliably while maintaining a small amount of keyframes
 */
export class MmdModelAnimationGroupHermiteBuilder implements IMmdModelAnimationGroupBuilder {
    public createBonePositionAnimation(mmdAnimationTrack: MmdMovableBoneAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, mmdAnimationTrack.name + ".position", 30, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const positions = mmdAnimationTrack.positions;
        const positionInterpolations = mmdAnimationTrack.positionInterpolations;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; ++i) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;

            keys[i] = {
                frame: frame,
                value: new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
                inTangent: hasPreviousFrame
                    ? new Vector3(
                        computeHermiteTangent(1 - positionInterpolations[i * 12 + 1] / 127, 1 - positionInterpolations[i * 12 + 3] / 127, inFrameDelta, positions[i * 3] - positions[(i - 1) * 3]),
                        computeHermiteTangent(1 - positionInterpolations[i * 12 + 5] / 127, 1 - positionInterpolations[i * 12 + 7] / 127, inFrameDelta, positions[i * 3 + 1] - positions[(i - 1) * 3 + 1]),
                        computeHermiteTangent(1 - positionInterpolations[i * 12 + 9] / 127, 1 - positionInterpolations[i * 12 + 11] / 127, inFrameDelta, positions[i * 3 + 2] - positions[(i - 1) * 3 + 2])
                    )
                    : undefined,
                outTangent: nextFrame < Infinity
                    ? new Vector3(
                        computeHermiteTangent(positionInterpolations[(i + 1) * 12 + 0] / 127, positionInterpolations[(i + 1) * 12 + 2] / 127, outFrameDelta, positions[(i + 1) * 3] - positions[i * 3]),
                        computeHermiteTangent(positionInterpolations[(i + 1) * 12 + 4] / 127, positionInterpolations[(i + 1) * 12 + 6] / 127, outFrameDelta, positions[(i + 1) * 3 + 1] - positions[i * 3 + 1]),
                        computeHermiteTangent(positionInterpolations[(i + 1) * 12 + 8] / 127, positionInterpolations[(i + 1) * 12 + 10] / 127, outFrameDelta, positions[(i + 1) * 3 + 2] - positions[i * 3 + 2])
                    )
                    : undefined,
                interpolation: AnimationKeyInterpolation.NONE,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    public createBoneRotationAnimation(mmdAnimationTrack: MmdBoneAnimationTrack | MmdMovableBoneAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, mmdAnimationTrack.name + ".rotationQuaternion", 30, Animation.ANIMATIONTYPE_QUATERNION, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const rotations = mmdAnimationTrack.rotations;
        const rotationInterpolations = mmdAnimationTrack.rotationInterpolations;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; ++i) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;

            keys[i] = {
                frame: frame,
                value: new Quaternion(rotations[i * 4], rotations[i * 4 + 1], rotations[i * 4 + 2], rotations[i * 4 + 3]),
                inTangent: hasPreviousFrame
                    ? new Quaternion(
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 4] - rotations[(i - 1) * 4]),
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 4 + 1] - rotations[(i - 1) * 4 + 1]),
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 4 + 2] - rotations[(i - 1) * 4 + 2]),
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 4 + 3] - rotations[(i - 1) * 4 + 3])
                    )
                    : undefined,
                outTangent: nextFrame < Infinity
                    ? new Quaternion(
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 4] - rotations[i * 4]),
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 4 + 1] - rotations[i * 4 + 1]),
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 4 + 2] - rotations[i * 4 + 2]),
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 4 + 3] - rotations[i * 4 + 3])
                    )
                    : undefined,
                interpolation: AnimationKeyInterpolation.NONE,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    public createMorphAnimation(mmdAnimationTrack: MmdMorphAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, mmdAnimationTrack.name, 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const weights = mmdAnimationTrack.weights;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; ++i) {
            keys[i] = {
                frame: frameNumbers[i],
                value: weights[i],
                interpolation: AnimationKeyInterpolation.NONE
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    public createPropertyAnimation(mmdAnimationTrack: MmdPropertyAnimationTrack): Animation[] {
        const animations: Animation[] = new Array(mmdAnimationTrack.ikBoneNames.length);

        const ikBoneNames = mmdAnimationTrack.ikBoneNames;
        for (let i = 0; i < ikBoneNames.length; ++i) {
            const animation = animations[i] = new Animation(mmdAnimationTrack.name, ikBoneNames[i], 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);

            const frameNumbers = mmdAnimationTrack.frameNumbers;
            const ikStates = mmdAnimationTrack.ikStates[i];

            const keys = new Array<IAnimationKey>(frameNumbers.length);
            for (let j = 0; j < frameNumbers.length; ++j) {
                keys[j] = {
                    frame: frameNumbers[j],
                    value: ikStates[j],
                    interpolation: AnimationKeyInterpolation.STEP
                };
            }
            animation.setKeys(keys);
        }

        return animations;
    }

    public createVisibilityAnimation(mmdAnimationTrack: MmdPropertyAnimationTrack): Nullable<Animation> {
        const animation = new Animation(mmdAnimationTrack.name, mmdAnimationTrack.name + ".visibility", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const visibles = mmdAnimationTrack.visibles;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; ++i) {
            keys[i] = {
                frame: frameNumbers[i],
                value: visibles[i],
                interpolation: AnimationKeyInterpolation.STEP
            };
        }
        animation.setKeys(keys);

        return 0 < frameNumbers.length ? animation : null;
    }
}

/**
 * Samples the bezier curve for every frame for import animation bezier curve parameter
 *
 * This method samples the bezier curve with 30 frames to preserve the shape of the curve as much as possible. However, it will use a lot of memory
 */
// export class MmdModelAnimationGroupSampleBuilder implements IMmdModelAnimationBuilder {

// }


/**
 * Use bezier interpolation for import animation bezier curve parameter
 *
 * This method uses the bezier curve as it is, But since babylon.js doesn't support bazier curves, we inject a bazier curve implementation to make it possible
 *
 * This method is not compatible with the Animation Curve Editor, but it allows you to import animation data completely lossless
 */
// export class MmdModelAnimationGroupBezierBuilder implements IMmdModelAnimationBuilder {

// }
