use super::mmd_animation_track::{MmdBoneAnimationTrack, MmdMorphAnimationTrack, MmdMovableBoneAnimationTrack, MmdPropertyAnimationTrack};

pub(crate) struct MmdAnimation {
    id: u32,
    bone_tracks: Box<[MmdBoneAnimationTrack]>,
    movable_bone_tracks: Box<[MmdMovableBoneAnimationTrack]>,
    morph_tracks: Box<[MmdMorphAnimationTrack]>,
    property_track: MmdPropertyAnimationTrack,
}

impl MmdAnimation {
    pub(crate) fn new(
        id: u32,
        bone_tracks: Box<[MmdBoneAnimationTrack]>,
        movable_bone_tracks: Box<[MmdMovableBoneAnimationTrack]>,
        morph_tracks: Box<[MmdMorphAnimationTrack]>,
        property_track: MmdPropertyAnimationTrack,
    ) -> Self {
        Self {
            id,
            bone_tracks,
            movable_bone_tracks,
            morph_tracks,
            property_track,
        }
    }

    pub(crate) fn id(&self) -> u32 {
        self.id
    }

    pub(crate) fn bone_tracks(&self) -> &[MmdBoneAnimationTrack] {
        &self.bone_tracks
    }

    pub(crate) fn movable_bone_tracks(&self) -> &[MmdMovableBoneAnimationTrack] {
        &self.movable_bone_tracks
    }

    pub(crate) fn morph_tracks(&self) -> &[MmdMorphAnimationTrack] {
        &self.morph_tracks
    }

    pub(crate) fn property_track(&self) -> &MmdPropertyAnimationTrack {
        &self.property_track
    }
}
