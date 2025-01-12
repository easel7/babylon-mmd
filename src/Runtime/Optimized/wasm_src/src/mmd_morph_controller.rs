use std::cell::RefCell;

use glam::Quat;

use crate::mmd_model_metadata::MorphMetadata;
use crate::mmd_runtime_bone::MmdRuntimeBoneArena;
use crate::unchecked_slice::{UncheckedSlice, UncheckedSliceMut};

pub(crate) struct MmdMorphController {
    morphs: Box<[MorphMetadata]>,
    active_morphs: Box<[bool]>,
    group_morph_stack: RefCell<Vec<(i32, f32)>>,
}

impl MmdMorphController {
    pub(crate) fn new(mut morphs: Box<[MorphMetadata]>) -> Self {
        let mut group_morph_stack = Vec::new();
        {
            let mut morphs = UncheckedSliceMut::new(&mut morphs);
            fn fix_looping_group_morphs(morphs: &mut [MorphMetadata], group_morph_stack: &mut Vec<(i32, f32)>, morph_index: i32) {
                let morph_indices = if let MorphMetadata::Group(morph) = &mut morphs[morph_index as usize] {
                    &mut morph.indices
                } else {
                    return;
                };

                for i in 0..morph_indices.len() {
                    let morph_indices = if let MorphMetadata::Group(morph) = &mut morphs[morph_index as usize] {
                        &mut morph.indices
                    } else {
                        return;
                    };
                    let index = morph_indices[i];

                    if group_morph_stack.iter().any(|(index, _)| *index == morph_index) {
                        // no need to diagnostic message because same error will be reported in the typescript side
                        morph_indices[i] = -1;
                    } else if 0 <= index && index < morphs.len() as i32 {
                        group_morph_stack.push((morph_index, 0.0));
                        fix_looping_group_morphs(morphs, group_morph_stack, index);
                        group_morph_stack.pop();
                    }
                }
            }
            for i in 0..morphs.len() {
                group_morph_stack.push((i as i32, 0.0));
                fix_looping_group_morphs(&mut morphs, &mut group_morph_stack, i as i32);
                group_morph_stack.clear();
            }
        }

        let active_morphs = vec![false; morphs.len()].into_boxed_slice();
        MmdMorphController {
            morphs,
            active_morphs,
            group_morph_stack: RefCell::new(group_morph_stack),
        }
    }

    fn morphs(&self) -> UncheckedSlice<MorphMetadata> {
        UncheckedSlice::new(&self.morphs)
    }

    fn active_morphs(&self) -> UncheckedSlice<bool> {
        UncheckedSlice::new(&self.active_morphs)
    }

    fn active_morphs_mut(&mut self) -> UncheckedSliceMut<bool> {
        UncheckedSliceMut::new(&mut self.active_morphs)
    }

    pub(crate) fn update(&mut self, bone_arena: &mut MmdRuntimeBoneArena, morph_weights: UncheckedSlice<f32>) {
        for i in 0..self.active_morphs().len() as u32 {
            if self.active_morphs()[i] {
                self.reset_morph(i, bone_arena);
            }
        }

        for (i, weight) in morph_weights.iter().enumerate() {
            if *weight == 0.0 {
                self.active_morphs_mut()[i as u32] = false;
                continue;
            }

            self.active_morphs_mut()[i as u32] = true;
            self.apply_morph(i as u32, bone_arena, *weight);
        }
    }

    fn reset_morph(&self, i: u32, arena: &mut MmdRuntimeBoneArena) {
        match &self.morphs()[i] {
            MorphMetadata::Bone(bone_morph) => {
                for index in bone_morph.indices.iter() {
                    if let Some(bone) = arena.arena_mut().get_mut(*index as u32) {
                        bone.morph_position_offset = None;
                        bone.morph_rotation_offset = None;
                    }
                }
            }
            MorphMetadata::Group(_) => {
                self.group_morph_flat_foreach(i as i32, |index, _| {
                    self.reset_morph(index as u32, arena);
                });
            }
        }
    }

    fn apply_morph(&self, i: u32, arena: &mut MmdRuntimeBoneArena, weight: f32) {
        match &self.morphs()[i] {
            MorphMetadata::Bone(bone_morph) => {
                for i in 0..bone_morph.indices.len() {
                    let index = bone_morph.indices[i];

                    let mut bone_arena = arena.arena_mut();
                    let bone = if let Some(bone) = bone_arena.get_mut(index as u32) {
                        bone
                    } else {
                        continue;
                    };
                    
                    let position = bone_morph.positions[i];
                    let rotation = bone_morph.rotations[i];

                    bone.morph_position_offset = if let Some(morph_position_offset) = bone.morph_position_offset {
                        Some(morph_position_offset + position * weight)
                    } else {
                        Some(position * weight)
                    };

                    bone.morph_rotation_offset = if let Some(morph_rotation_offset) = bone.morph_rotation_offset {
                        Some(morph_rotation_offset.slerp(rotation, weight))
                    } else {
                        Some(Quat::IDENTITY.slerp(rotation, weight))
                    };
                }
            }
            MorphMetadata::Group(_) => {
                self.group_morph_flat_foreach(i as i32, |index, accumulated_ratio| {
                    self.apply_morph(index as u32, arena, weight * accumulated_ratio);
                });
            }
        }
    }

    fn group_morph_flat_foreach(
        &self,
        group_morph_index: i32,
        mut f: impl FnMut(i32, f32),
    ) {
        let mut stack = self.group_morph_stack.borrow_mut();
        stack.push((group_morph_index, 1.0));

        while let Some((group_morph_index, accumulated_ratio)) = stack.pop() {
            let morphs = self.morphs();
            let morph = morphs.get(group_morph_index as u32);
            let morph = if let Some(morph) = morph {
                morph
            } else {
                continue;
            };

            if let MorphMetadata::Group(group_morph) = morph {
                for (index, ratio) in group_morph.indices.iter().zip(group_morph.ratios.iter()) {
                    stack.push((*index, accumulated_ratio * *ratio));
                }
            } else {
                f(group_morph_index, accumulated_ratio);
            }
        }
    }
}
