import { Animation } from "@babylonjs/core/Animations/animation";
import type { IAnimationKey } from "@babylonjs/core/Animations/animationKey";
import { AnimationKeyInterpolation } from "@babylonjs/core/Animations/animationKey";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { computeHermiteTangent } from "./Common/computeHermiteTangent";
import type { IMmdAnimation } from "./IMmdAnimation";
import type { MmdAnimation } from "./mmdAnimation";
import type { MmdCameraAnimationTrack } from "./mmdAnimationTrack";

/**
 * A container type that stores mmd camera animations using the `Animation` container in babylon.js
 *
 * It aims to utilize the animation runtime of babylon.js
 */
export class MmdCameraAnimationGroup implements IMmdAnimation {
    /**
     * Animation name for identification
     */
    public readonly name: string;

    /**
     * Position animation track for `MmdCamera.position`
     */
    public readonly positionAnimation: Animation;

    /**
     * Rotation animation track for `MmdCamera.rotation`
     */
    public readonly rotationAnimation: Animation;

    /**
     * Distance animation track for `MmdCamera.distance`
     */
    public readonly distanceAnimation: Animation;

    /**
     * FOV animation track for `MmdCamera.fov`
     */
    public readonly fovAnimation: Animation;

    /**
     * The start frame of this animation
     */
    public readonly startFrame: number;

    /**
     * The end frame of this animation
     */
    public readonly endFrame: number;

    /**
     * Create a unbinded mmd camera animation group
     * @param mmdAnimation The mmd animation data
     * @param coverter The coverter for constructing mmd camera animation group
     */
    public constructor(
        mmdAnimation: MmdAnimation,
        coverter: new () => IMmdCameraAnimationCoverter
    ) {
        const coverterInstance = new coverter();

        this.name = mmdAnimation.name;

        this.positionAnimation = coverterInstance.createPositionAnimation(mmdAnimation.cameraTrack);
        this.rotationAnimation = coverterInstance.createRotationAnimation(mmdAnimation.cameraTrack);
        this.distanceAnimation = coverterInstance.createDistanceAnimation(mmdAnimation.cameraTrack);
        this.fovAnimation = coverterInstance.createFovAnimation(mmdAnimation.cameraTrack);

        this.startFrame = mmdAnimation.startFrame;
        this.endFrame = mmdAnimation.endFrame;
    }
}

/**
 * Mmd camera animation coverter for constructing mmd camera animation group
 */
export interface IMmdCameraAnimationCoverter {
    /**
     * create mmd camera position animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    createPositionAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation;

    /**
     * create mmd camera rotation animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    createRotationAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation;

    /**
     * create mmd camera distance animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    createDistanceAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation;

    /**
     * create mmd camera fov animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    createFovAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation;
}

/**
 * Use hermite interpolation for import animation bezier curve parameter
 *
 * This has some loss of curve shape, but it converts animations reliably while maintaining a small amount of keyframes
 */
export class MmdCameraAnimationHermiteCoverter implements IMmdCameraAnimationCoverter {
    /**
     * create mmd camera position animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    public createPositionAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, "position", 30, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const positions = mmdAnimationTrack.positions;
        const positionInterpolations = mmdAnimationTrack.positionInterpolations;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; i++) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;
            const interpolationKind = outFrameDelta < 1.0001 ? AnimationKeyInterpolation.STEP : AnimationKeyInterpolation.NONE;

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
                interpolation: interpolationKind,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    /**
     * create mmd camera rotation animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    public createRotationAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, "rotation", 30, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const rotations = mmdAnimationTrack.rotations;
        const rotationInterpolations = mmdAnimationTrack.rotationInterpolations;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; i++) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;
            const interpolationKind = outFrameDelta < 1.0001 ? AnimationKeyInterpolation.STEP : AnimationKeyInterpolation.NONE;

            keys[i] = {
                frame: frame,
                value: new Vector3(rotations[i * 3], rotations[i * 3 + 1], rotations[i * 3 + 2]),
                inTangent: hasPreviousFrame
                    ? new Vector3(
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 3] - rotations[(i - 1) * 3]),
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 3 + 1] - rotations[(i - 1) * 3 + 1]),
                        computeHermiteTangent(1 - rotationInterpolations[i * 4 + 1] / 127, 1 - rotationInterpolations[i * 4 + 3] / 127, inFrameDelta, rotations[i * 3 + 2] - rotations[(i - 1) * 3 + 2])
                    )
                    : undefined,
                outTangent: nextFrame < Infinity
                    ? new Vector3(
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 3] - rotations[i * 3]),
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 3 + 1] - rotations[i * 3 + 1]),
                        computeHermiteTangent(rotationInterpolations[(i + 1) * 4 + 0] / 127, rotationInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, rotations[(i + 1) * 3 + 2] - rotations[i * 3 + 2])
                    )
                    : undefined,
                interpolation: interpolationKind,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    /**
     * create mmd camera distance animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    public createDistanceAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, "distance", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const distances = mmdAnimationTrack.distances;
        const distanceInterpolations = mmdAnimationTrack.distanceInterpolations;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; i++) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;
            const interpolationKind = outFrameDelta < 1.0001 ? AnimationKeyInterpolation.STEP : AnimationKeyInterpolation.NONE;

            keys[i] = {
                frame: frame,
                value: distances[i],
                inTangent: hasPreviousFrame
                    ? computeHermiteTangent(1 - distanceInterpolations[i * 4 + 1] / 127, 1 - distanceInterpolations[i * 4 + 3] / 127, inFrameDelta, distances[i] - distances[i - 1])
                    : undefined,
                outTangent: nextFrame < Infinity
                    ? computeHermiteTangent(distanceInterpolations[(i + 1) * 4 + 0] / 127, distanceInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, distances[i + 1] - distances[i])
                    : undefined,
                interpolation: interpolationKind,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }

    /**
     * create mmd camera fov animation
     * @param mmdAnimationTrack mmd camera animation track
     * @returns babylon.js animation
     */
    public createFovAnimation(mmdAnimationTrack: MmdCameraAnimationTrack): Animation {
        const animation = new Animation(mmdAnimationTrack.name, "fov", 30, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);

        const frameNumbers = mmdAnimationTrack.frameNumbers;
        const fovs = mmdAnimationTrack.fovs;
        const fovInterpolations = mmdAnimationTrack.fovInterpolations;

        const degToRad = Math.PI / 180;

        const keys = new Array<IAnimationKey>(frameNumbers.length);
        for (let i = 0; i < frameNumbers.length; i++) {
            const frame = frameNumbers[i];
            const hasPreviousFrame = 0 < i;
            const nextFrame = i + 1 < frameNumbers.length ? frameNumbers[i + 1] : Infinity;
            const inFrameDelta = frame - (0 < i ? frameNumbers[i - 1] : -30);
            const outFrameDelta = nextFrame - frame;
            const interpolationKind = outFrameDelta < 1.0001 ? AnimationKeyInterpolation.STEP : AnimationKeyInterpolation.NONE;

            keys[i] = {
                frame: frame,
                value: fovs[i] * degToRad,
                inTangent: hasPreviousFrame
                    ? computeHermiteTangent(1 - fovInterpolations[i * 4 + 1] / 127, 1 - fovInterpolations[i * 4 + 3] / 127, inFrameDelta, fovs[i] * degToRad - fovs[i - 1] * degToRad)
                    : undefined,
                outTangent: nextFrame < Infinity
                    ? computeHermiteTangent(fovInterpolations[(i + 1) * 4 + 0] / 127, fovInterpolations[(i + 1) * 4 + 2] / 127, outFrameDelta, fovs[i + 1] * degToRad - fovs[i] * degToRad)
                    : undefined,
                interpolation: interpolationKind,
                lockedTangent: false
            };
        }
        animation.setKeys(keys);

        return animation;
    }
}

/**
 * Samples the bezier curve for every frame for import animation bezier curve parameter
 *
 * This method samples the bezier curve with 30 frames to preserve the shape of the curve as much as possible. However, it will use a lot of memory
 */
// export class MmdCameraAnimationSampleCoverter implements IMmdCameraAnimationCoverter {

// }


/**
 * Use bezier interpolation for import animation bezier curve parameter
 *
 * This method uses the bezier curve as it is, But since babylon.js doesn't support bazier curves, we inject a bazier curve implementation to make it possible
 *
 * This method is not compatible with the Animation Curve Editor, but it allows you to import animation data completely lossless
 */
// export class MmdCameraAnimationBezierCoverter implements IMmdCameraAnimationCoverter {

// }
