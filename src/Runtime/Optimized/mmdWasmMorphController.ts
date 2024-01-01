import type { Material } from "@babylonjs/core/Materials/material";
import type { Nullable } from "@babylonjs/core/types";

import type { MmdModelMetadata } from "@/Loader/mmdModelMetadata";

import type { ILogger } from "../ILogger";
import type { IMmdMaterialProxyConstructor } from "../IMmdMaterialProxy";
import type { RuntimeMorph } from "../mmdMorphControllerBase";
import { MmdMorphControllerBase } from "../mmdMorphControllerBase";

export class MmdWasmMorphController extends MmdMorphControllerBase {
    private readonly _wasmMorphWeights: Float32Array;
    private readonly _wasmMorphIndexMap: Int32Array;

    /**
     * Creates a new MmdWasmMorphController
     * @param wasmMorphWeights WASM side morph weights
     * @param wasmMorphIndexMap Mmd morph to WASM morph index map
     * @param materials MMD materials which are order of mmd metadata
     * @param materialProxyConstructor The constructor of `IMmdMaterialProxy`
     * @param morphsMetadata Morphs metadata
     * @param logger Logger
     */
    public constructor(
        wasmMorphWeights: Float32Array,
        wasmMorphIndexMap: Int32Array,
        materials: Material[],
        materialProxyConstructor: Nullable<IMmdMaterialProxyConstructor<Material>>,
        morphsMetadata: readonly MmdModelMetadata.Morph[],
        logger: ILogger
    ) {
        super(null, materials, materialProxyConstructor, morphsMetadata, logger);

        this._wasmMorphWeights = wasmMorphWeights;
        this._wasmMorphIndexMap = wasmMorphIndexMap;
    }

    /**
     * Sets the weight of the morph
     *
     * If there are multiple morphs with the same name, all of them will be set to the same weight, this is the behavior of MMD
     * @param morphName Name of the morph
     * @param weight Weight of the morph
     */
    public override setMorphWeight(morphName: string, weight: number): void {
        const morphIndexMap = this._morphIndexMap;
        const morphIndices = morphIndexMap.get(morphName);
        if (morphIndices === undefined) return;

        const morphWeights = this._morphWeights;

        const wasmMorphWeights = this._wasmMorphWeights;
        const wasmMorphIndexMap = this._wasmMorphIndexMap;

        for (let i = 0; i < morphIndices.length; ++i) {
            const morphIndex = morphIndices[i];
            morphWeights[morphIndex] = weight;

            wasmMorphWeights[wasmMorphIndexMap[morphIndex]] = weight;
        }

        if (weight !== 0) {
            this._activeMorphs.add(morphName);
        }
    }

    /**
     * Sets the weight of the morph from the index
     *
     * This method is faster than `setMorphWeight` because it does not need to search the morphs with the given name
     */
    public override setMorphWeightFromIndex(morphIndex: number, weight: number): void {
        this._morphWeights[morphIndex] = weight;
        this._wasmMorphWeights[this._wasmMorphIndexMap[morphIndex]] = weight;

        if (weight !== 0) {
            this._activeMorphs.add(this._morphs[morphIndex].name);
        }
    }

    /**
     * Set the weights of all morphs to 0
     */
    public override resetMorphWeights(): void {
        super.resetMorphWeights();
        this._wasmMorphWeights.fill(0);
    }

    protected override _resetBoneMorph(_morph: RuntimeMorph): void { }

    protected override _applyBoneMorph(_morph: RuntimeMorph, _weight: number): void { }
}