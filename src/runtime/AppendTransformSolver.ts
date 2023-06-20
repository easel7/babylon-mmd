import { Quaternion, Space } from "@babylonjs/core";

import type { MmdBone, MmdSkeleton } from "./MmdMesh";

export class AppendTransformSolver {
    private readonly _skeleton: MmdSkeleton;

    public constructor(skeleton: MmdSkeleton) {
        this._skeleton = skeleton;
    }

    private _tempQuaternion = new Quaternion();

    public update(bone: MmdBone): void {
        const appendTransformMetadata = bone.metadata.appendTransform;
        if (appendTransformMetadata === undefined) return;

        const bones = this._skeleton.bones;

        if (appendTransformMetadata.affectRotation) {
            const appendRotation = this._tempQuaternion;
        	if (appendTransformMetadata.isLocal) {
                bone.getRotationQuaternionToRef(Space.LOCAL, undefined, appendRotation);
        	} else {
                const appendBone = bones[appendTransformMetadata.parentIndex];
        		if (appendBone !== undefined) {
                    appendBone.getRotationQuaternionToRef(Space.LOCAL, undefined, appendRotation);
        		} else {
                    bone.getRotationQuaternionToRef(Space.LOCAL, undefined, appendRotation);
                }
        	}
        }

        // 	glm::quat appendQ = Quaternion.SlerpToRef(
        // 		glm::quat(1, 0, 0, 0),
        // 		appendRotate,
        //         appendTransformMetadata.ratio
        // 	);
        // 	m_appendRotate = appendQ;
        }

        // if (appendTransformMetadata.affectPosition) {
        // 	glm::vec3 appendTranslate(0.0f);
        // 	if (m_isAppendLocal)
        // 	{
        // 		appendTranslate = m_appendNode->GetTranslate() - m_appendNode->GetInitialTranslate();
        // 	}
        // 	else
        // 	{
        // 		if (m_appendNode->GetAppendNode() != nullptr)
        // 		{
        // 			appendTranslate = m_appendNode->GetAppendTranslate();
        // 		}
        // 		else
        // 		{
        // 			appendTranslate = m_appendNode->GetTranslate() - m_appendNode->GetInitialTranslate();
        // 		}
        // 	}

        // 	m_appendTranslate = appendTranslate * GetAppendWeight();
        // }

        // UpdateLocalTransform();
    }
}
