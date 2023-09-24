import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Loading/loadingScreen";
import "@babylonjs/core/Rendering/prePassRendererSceneComponent";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Rendering/geometryBufferRendererSceneComponent";
import "@/Loader/Optimized/bpmxLoader";
import "@/Runtime/Animation/mmdRuntimeCameraAnimationGroup";
import "@/Runtime/Animation/mmdRuntimeModelAnimationGroup";

import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { SkeletonViewer } from "@babylonjs/core/Debug/skeletonViewer";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Engine } from "@babylonjs/core/Engines/engine";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { DepthOfFieldEffectBlurLevel } from "@babylonjs/core/PostProcesses/depthOfFieldEffect";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { SSRRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import HavokPhysics from "@babylonjs/havok";
import { Inspector } from "@babylonjs/inspector";

import type { MmdAnimation } from "@/Loader/Animation/mmdAnimation";
import { MmdCameraAnimationGroup, MmdCameraAnimationGroupBezierBuilder } from "@/Loader/Animation/mmdCameraAnimationGroup";
import { MmdModelAnimationGroup, MmdModelAnimationGroupBezierBuilder } from "@/Loader/Animation/mmdModelAnimationGroup";
import type { MmdStandardMaterialBuilder } from "@/Loader/mmdStandardMaterialBuilder";
import type { BpmxLoader } from "@/Loader/Optimized/bpmxLoader";
import { BvmdLoader } from "@/Loader/Optimized/bvmdLoader";
import { SdefInjector } from "@/Loader/sdefInjector";
import { StreamAudioPlayer } from "@/Runtime/Audio/streamAudioPlayer";
import { MmdCamera } from "@/Runtime/mmdCamera";
import { MmdPhysics } from "@/Runtime/mmdPhysics";
import { MmdRuntime } from "@/Runtime/mmdRuntime";
import { MmdPlayerControl } from "@/Runtime/Util/mmdPlayerControl";

import type { ISceneBuilder } from "../baseRuntime";
import { createLightComponents } from "../Util/createLightComponents";

export class SceneBuilder implements ISceneBuilder {
    public async build(canvas: HTMLCanvasElement, engine: Engine): Promise<Scene> {
        SdefInjector.OverrideEngineCreateEffect(engine);
        const pmxLoader = SceneLoader.GetPluginForExtension(".bpmx") as BpmxLoader;
        pmxLoader.loggingEnabled = true;
        const materialBuilder = pmxLoader.materialBuilder as MmdStandardMaterialBuilder;
        materialBuilder.alphaEvaluationResolution = 2048;
        // materialBuilder.loadDiffuseTexture = (): void => { /* do nothing */ };
        // materialBuilder.loadSphereTexture = (): void => { /* do nothing */ };
        // materialBuilder.loadToonTexture = (): void => { /* do nothing */ };
        materialBuilder.loadOutlineRenderingProperties = (): void => { /* do nothing */ };
        materialBuilder.afterBuildSingleMaterial = (material): void => {
            material.useLogarithmicDepth = true;
        };
        pmxLoader.boundingBoxMargin = 60;

        const scene = new Scene(engine);
        scene.clearColor = new Color4(0.95, 0.95, 0.95, 1.0);

        const mmdCamera = new MmdCamera("mmdCamera", new Vector3(0, 10, 0), scene);
        mmdCamera.maxZ = 5000;

        const mmdRoot = new TransformNode("mmdRoot", scene);
        mmdCamera.parent = mmdRoot;
        mmdRoot.position.z -= 0;

        const camera = new ArcRotateCamera("arcRotateCamera", 0, 0, 45, new Vector3(0, 10, 0), scene);
        camera.maxZ = 5000;
        camera.setPosition(new Vector3(0, 10, -45));
        camera.attachControl(canvas, false);
        camera.inertia = 0.8;
        camera.speed = 10;

        const { directionalLight, shadowGenerator } = createLightComponents(scene);

        const mmdRuntime = new MmdRuntime(new MmdPhysics(scene));
        mmdRuntime.loggingEnabled = true;

        mmdRuntime.register(scene);

        const audioPlayer = new StreamAudioPlayer(scene);
        audioPlayer.preservesPitch = false;
        audioPlayer.source = "res/private_test/motion/flos/flos_YuNi.mp3";

        const mmdPlayerControl = new MmdPlayerControl(scene, mmdRuntime, audioPlayer);
        mmdPlayerControl.showPlayerControl();

        engine.displayLoadingUI();

        let loadingTexts: string[] = [];
        const updateLoadingText = (updateIndex: number, text: string): void => {
            loadingTexts[updateIndex] = text;
            engine.loadingUIText = "<br/><br/><br/><br/>" + loadingTexts.join("<br/><br/>");
        };

        const promises: Promise<any>[] = [];

        const bvmdLoader = new BvmdLoader(scene);
        bvmdLoader.loggingEnabled = true;

        promises.push(bvmdLoader.loadAsync("motion", "res/private_test/motion/flos/motion.bvmd",
            (event) => updateLoadingText(0, `Loading motion... ${event.loaded}/${event.total} (${Math.floor(event.loaded * 100 / event.total)}%)`))
        );

        promises.push(SceneLoader.ImportMeshAsync(
            undefined,
            "res/private_test/model/",
            "yyb_deep_canyons_miku.bpmx",
            scene,
            (event) => updateLoadingText(1, `Loading model... ${event.loaded}/${event.total} (${Math.floor(event.loaded * 100 / event.total)}%)`)
        ));

        pmxLoader.buildSkeleton = false;
        pmxLoader.buildMorph = false;
        promises.push(SceneLoader.ImportMeshAsync(
            undefined,
            "res/private_test/stage/",
            "water house.bpmx",
            scene,
            (event) => updateLoadingText(2, `Loading stage... ${event.loaded}/${event.total} (${Math.floor(event.loaded * 100 / event.total)}%)`)
        ));

        promises.push((async(): Promise<void> => {
            updateLoadingText(3, "Loading physics engine...");
            const havokInstance = await HavokPhysics();
            const havokPlugin = new HavokPlugin(true, havokInstance);
            scene.enablePhysics(new Vector3(0, -9.8 * 10, 0), havokPlugin);
            updateLoadingText(3, "Loading physics engine... Done");
        })());

        loadingTexts = new Array(promises.length).fill("");

        const loadResults = await Promise.all(promises);

        scene.onAfterRenderObservable.addOnce(() => engine.hideLoadingUI());

        scene.meshes.forEach((mesh) => {
            if (mesh.name === "skyBox") return;
            mesh.receiveShadows = true;
            shadowGenerator.addShadowCaster(mesh);
        });

        const modelMesh = loadResults[1].meshes[0] as Mesh;
        modelMesh.parent = mmdRoot;

        const mmdModel = mmdRuntime.createMmdModel(modelMesh, {
            buildPhysics: true
        });

        const mmdModelAnimationGroup = new MmdModelAnimationGroup(loadResults[0] as MmdAnimation, new MmdModelAnimationGroupBezierBuilder());
        const mmdCameraAnimationGroup = new MmdCameraAnimationGroup(loadResults[0] as MmdAnimation, new MmdCameraAnimationGroupBezierBuilder());

        mmdModelAnimationGroup.createAnimationGroup(mmdModel).play();
        mmdCameraAnimationGroup.createAnimationGroup(mmdCamera).play();
        audioPlayer.play();

        Inspector.Show(scene, { });

        {

            const bodyBone = modelMesh.skeleton!.bones.find((bone) => bone.name === "センター");
            const meshWorldMatrix = modelMesh.getWorldMatrix();
            const boneWorldMatrix = new Matrix();
            scene.onBeforeRenderObservable.add(() => {
                boneWorldMatrix.copyFrom(bodyBone!.getFinalMatrix()).multiplyToRef(meshWorldMatrix, boneWorldMatrix);
                boneWorldMatrix.getTranslationToRef(directionalLight.position);
                directionalLight.position.y -= 10;

                camera.target.copyFrom(directionalLight.position);
                camera.target.y += 13;
            });

            const viewer = new SkeletonViewer(modelMesh.skeleton!, modelMesh, scene, false, 3, {
                displayMode: SkeletonViewer.DISPLAY_SPHERE_AND_SPURS
            });
            viewer.isEnabled = false;
        }

        const mmdStageMesh = loadResults[2].meshes[0] as Mesh;
        mmdStageMesh.receiveShadows = true;
        mmdStageMesh.position.y += 0.01;

        const useHavyPostProcess = true;
        const useBasicPostProcess = true;

        if (useHavyPostProcess) {
            const ssr = new SSRRenderingPipeline(
                "ssr",
                scene,
                [mmdCamera, camera],
                false,
                Constants.TEXTURETYPE_UNSIGNED_BYTE
            );
            ssr.step = 32;
            ssr.maxSteps = 128;
            ssr.maxDistance = 500;
            ssr.enableSmoothReflections = false;
            ssr.enableAutomaticThicknessComputation = false;
            ssr.blurDownsample = 2;
            ssr.ssrDownsample = 2;
            ssr.thickness = 0.1;
            ssr.selfCollisionNumSkip = 2;
            ssr.blurDispersionStrength = 0;
            ssr.roughnessFactor = 0.1;
            ssr.reflectivityThreshold = 0.9;
            ssr.samples = 4;
        }

        if (useBasicPostProcess) {
            const defaultPipeline = new DefaultRenderingPipeline("default", true, scene, [mmdCamera, camera]);
            defaultPipeline.samples = 4;
            defaultPipeline.bloomEnabled = true;
            defaultPipeline.chromaticAberrationEnabled = true;
            defaultPipeline.chromaticAberration.aberrationAmount = 1;
            defaultPipeline.depthOfFieldEnabled = true;
            defaultPipeline.depthOfFieldBlurLevel = DepthOfFieldEffectBlurLevel.High;
            defaultPipeline.fxaaEnabled = true;
            defaultPipeline.imageProcessingEnabled = true;
            defaultPipeline.imageProcessing.toneMappingEnabled = true;
            defaultPipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
            defaultPipeline.imageProcessing.vignetteWeight = 0.5;
            defaultPipeline.imageProcessing.vignetteStretch = 0.5;
            defaultPipeline.imageProcessing.vignetteColor = new Color4(0, 0, 0, 0);
            defaultPipeline.imageProcessing.vignetteEnabled = true;

            defaultPipeline.depthOfField.fStop = 0.05;
            defaultPipeline.depthOfField.focalLength = 20;

            // note: this dof distance compute will broken when camera and mesh is not in same space

            const modelMesh = loadResults[1].meshes[0] as Mesh;
            const headBone = modelMesh.skeleton!.bones.find((bone) => bone.name === "頭");

            const rotationMatrix = new Matrix();
            const cameraNormal = new Vector3();
            const cameraEyePosition = new Vector3();
            const headRelativePosition = new Vector3();

            scene.onBeforeRenderObservable.add(() => {
                const cameraRotation = mmdCamera.rotation;
                Matrix.RotationYawPitchRollToRef(-cameraRotation.y, -cameraRotation.x, -cameraRotation.z, rotationMatrix);

                Vector3.TransformNormalFromFloatsToRef(0, 0, 1, rotationMatrix, cameraNormal);

                mmdCamera.position.addToRef(
                    Vector3.TransformCoordinatesFromFloatsToRef(0, 0, mmdCamera.distance, rotationMatrix, cameraEyePosition),
                    cameraEyePosition
                );

                headBone!.getFinalMatrix().getTranslationToRef(headRelativePosition)
                    .subtractToRef(cameraEyePosition, headRelativePosition);

                defaultPipeline.depthOfField.focusDistance = (Vector3.Dot(headRelativePosition, cameraNormal) / Vector3.Dot(cameraNormal, cameraNormal)) * 1000;
            });

            let lastClickTime = -Infinity;
            canvas.onclick = (): void => {
                const currentTime = performance.now();
                if (500 < currentTime - lastClickTime) {
                    lastClickTime = currentTime;
                    return;
                }

                lastClickTime = -Infinity;

                if (scene.activeCamera === mmdCamera) {
                    defaultPipeline.depthOfFieldEnabled = false;
                    scene.activeCamera = camera;
                } else {
                    defaultPipeline.depthOfFieldEnabled = true;
                    scene.activeCamera = mmdCamera;
                }
            };
        }

        // Inspector.Show(scene, { });

        return scene;
    }
}
