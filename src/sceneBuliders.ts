import type { Engine } from "@babylonjs/core";
import { DirectionalLight, HavokPlugin, HemisphericLight, Material, MeshBuilder, Scene, SceneLoader, ShadowGenerator, Vector3 } from "@babylonjs/core";
import HavokPhysics from "@babylonjs/havok";
import type { MmdStandardMaterialBuilder } from "babylon-mmd";
import { MmdCamera, MmdMesh, MmdPhysics, MmdPlayerControl, MmdRuntime, PmxLoader, SdefInjector, StreamAudioPlayer, VmdLoader } from "babylon-mmd";

import type { ISceneBuilder } from "./baseRuntime";

export class SceneBuilder implements ISceneBuilder {
    public async build(_canvas: HTMLCanvasElement, engine: Engine): Promise<Scene> {
        SdefInjector.OverrideEngineCreateEffect(engine);
        SceneLoader.RegisterPlugin(new PmxLoader());

        // fix material alpha mode
        const pmxLoader = SceneLoader.GetPluginForExtension(".pmx") as PmxLoader;
        const materialBuilder = pmxLoader.materialBuilder as MmdStandardMaterialBuilder;
        materialBuilder.useAlphaEvaluation = false;
        const alphaBlendMaterials = ["face02", "Facial02", "HL", "Hairshadow", "q302"];
        const alphaTestMaterials = ["q301"];
        materialBuilder.afterBuildSingleMaterial = (material): void => {
            if (!alphaBlendMaterials.includes(material.name) && !alphaTestMaterials.includes(material.name)) return;
            material.transparencyMode = alphaBlendMaterials.includes(material.name)
                ? Material.MATERIAL_ALPHABLEND
                : Material.MATERIAL_ALPHATEST;
            material.useAlphaFromDiffuseTexture = true;
            material.diffuseTexture!.hasAlpha = true;
        };

        const scene = new Scene(engine);

        const camera = new MmdCamera("mmdCamera", new Vector3(0, 10, 0), scene);

        const hemisphericLight = new HemisphericLight("HemisphericLight", new Vector3(0, 1, 0), scene);
        hemisphericLight.intensity = 0.3;
        hemisphericLight.specular.set(0, 0, 0);
        hemisphericLight.groundColor.set(1, 1, 1);

        const directionalLight = new DirectionalLight("DirectionalLight", new Vector3(0.5, -1, 1), scene);
        directionalLight.intensity = 0.7;
        directionalLight.shadowMaxZ = 20;
        directionalLight.shadowMinZ = -15;

        const shadowGenerator = new ShadowGenerator(2048, directionalLight, true, camera);
        shadowGenerator.bias = 0.01;

        const ground = MeshBuilder.CreateGround("ground1", { width: 60, height: 60, subdivisions: 2, updatable: false }, scene);
        ground.receiveShadows = true;
        shadowGenerator.addShadowCaster(ground);

        // load mmd model
        const mmdMesh = await SceneLoader.ImportMeshAsync("", "res/YYB Hatsune Miku_10th/", "YYB Hatsune Miku_10th_v1.02.pmx", scene)
            .then((result) => result.meshes[0] as MmdMesh);
        for (const mesh of mmdMesh.metadata.meshes) mesh.receiveShadows = true;
        shadowGenerator.addShadowCaster(mmdMesh);

        // // enable physics
        scene.enablePhysics(new Vector3(0, -9.8 * 10, 0), new HavokPlugin(true, await HavokPhysics()));

        // create mmd runtime
        const mmdRuntime = new MmdRuntime(scene, new MmdPhysics(scene));
        mmdRuntime.register(scene);

        mmdRuntime.setCamera(camera);
        const mmdModel = mmdRuntime.createMmdModel(mmdMesh);

        // load animation
        const vmdLoader = new VmdLoader(scene);
        const modelMotion = await vmdLoader.loadAsync("model_motion_1", [
            "res/メランコリ・ナイト/メランコリ・ナイト.vmd",
            "res/メランコリ・ナイト/メランコリ・ナイト_表情モーション.vmd",
            "res/メランコリ・ナイト/メランコリ・ナイト_リップモーション.vmd"
        ]);
        const cameraMotion = await vmdLoader.loadAsync("camera_motion_1",
            "res/メランコリ・ナイト/メランコリ・ナイト_カメラ.vmd"
        );

        mmdModel.addAnimation(modelMotion);
        mmdModel.setAnimation("model_motion_1");

        camera.addAnimation(cameraMotion);
        camera.setAnimation("camera_motion_1");

        // add audio player
        const audioPlayer = new StreamAudioPlayer(scene);
        audioPlayer.source = "res/higma - メランコリナイト melancholy night feat.初音ミク.mp3";
        mmdRuntime.setAudioPlayer(audioPlayer);

        mmdRuntime.playAnimation();
        new MmdPlayerControl(scene, mmdRuntime, audioPlayer);

        return scene;
    }
}