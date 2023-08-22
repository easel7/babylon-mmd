import { MmdCameraAnimationGroup } from "@/Loader/Animation/mmdCameraAnimationGroup";

import type { MmdCamera } from "../mmdCamera";
import type { IMmdBindableCameraAnimation } from "./IMmdBindableAnimation";
import type { IMmdRuntimeCameraAnimation } from "./IMmdRuntimeAnimation";

/**
 * Mmd runtime camera animation that use animation runtime of babylon.js
 *
 * An object with mmd animation group and camera binding information
 */
export class MmdRuntimeCameraAnimationGroup implements IMmdRuntimeCameraAnimation {
    /**
     * The animation data
     */
    public readonly animation: MmdCameraAnimationGroup;

    private readonly _camera: MmdCamera;

    private constructor(
        animation: MmdCameraAnimationGroup,
        camera: MmdCamera
    ) {
        this.animation = animation;
        this._camera = camera;
    }

    /**
     * Update animation
     * @param frameTime frame time in 30fps
     */
    public animate(frameTime: number): void {
        frameTime;

        this._camera;

        throw new Error("Method not implemented.");
    }

    /**
     * bind animation to camera
     * @param animation animation to bind
     * @param camera bind target
     * @returns MmdRuntimeCameraAnimationGroup instance
     */
    public static Create(animation: MmdCameraAnimationGroup, camera: MmdCamera): MmdRuntimeCameraAnimationGroup {
        return new MmdRuntimeCameraAnimationGroup(animation, camera);
    }
}

declare module "../../Loader/Animation/mmdCameraAnimationGroup" {
    interface MmdCameraAnimationGroup extends IMmdBindableCameraAnimation<MmdRuntimeCameraAnimationGroup> { }
}

MmdCameraAnimationGroup.prototype.createRuntimeAnimation = function(camera: MmdCamera): MmdRuntimeCameraAnimationGroup {
    return MmdRuntimeCameraAnimationGroup.Create(this, camera);
};