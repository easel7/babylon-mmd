use std::num::NonZeroUsize;
use std::ptr::NonNull;

use crate::mmd_runtime_bone::{MmdRuntimeBone, MmdRuntimeBoneArena};
use crate::mmd_model_metadata::{MetadataBuffer, BoneMetadataReader, BoneFlag};
use crate::append_transform_solver::{AppendTransformSolver, AppendTransformSolverArena};
use crate::ik_solver::{IkSolver, IkSolverArena};
use crate::animation_arena::AnimationArena;
use crate::mmd_morph_controller::MmdMorphController;
use crate::animation::mmd_runtime_animation::MmdRuntimeAnimation;
use crate::unchecked_slice::UncheckedSliceMut;

pub(crate) struct MmdModel {
    runtime_animation: Option<NonZeroUsize>,
    animation_arena: AnimationArena,
    bone_arena: MmdRuntimeBoneArena,
    append_transform_solver_arena: AppendTransformSolverArena,
    ik_solver_arena: IkSolverArena,
    morph_controller: MmdMorphController,
    sorted_runtime_bones: Box<[u32]>,
    sorted_runtime_root_bones: Box<[u32]>,
}

impl MmdModel {
    pub(crate) fn new(buffer: MetadataBuffer) -> Self {
        let reader = BoneMetadataReader::new(buffer);

        let mut bone_arena: Vec<MmdRuntimeBone> = Vec::with_capacity(reader.bone_count() as usize);
        for i in 0..reader.bone_count() {
            bone_arena.push(MmdRuntimeBone::new(i));
        }
        let mut bone_arena = bone_arena.into_boxed_slice();

        let mut append_transform_solver_arena = Vec::with_capacity(reader.append_transform_count() as usize);
        let mut ik_solver_arena = Vec::with_capacity(reader.ik_count() as usize);
        
        let reader = reader.enumerate(|i, metadata| {
            {
                let bone = &mut bone_arena[i as usize];
                bone.rest_position = metadata.rest_position.into();
                bone.transform_order = metadata.transform_order;
                bone.transform_after_physics = metadata.flag & BoneFlag::TransformAfterPhysics as u16 != 0;
            }

            if 0 <= metadata.parent_bone_index && metadata.parent_bone_index < bone_arena.len() as i32 {
                let parent_bone = &mut bone_arena[metadata.parent_bone_index as usize];
                parent_bone.child_bones.push(i);
                let bone: &mut MmdRuntimeBone = &mut bone_arena[i as usize];
                bone.parent_bone = Some(metadata.parent_bone_index as u32);
            }
            
            if let Some(append_transform) = metadata.append_transform {
                let target_bone_index = append_transform.parent_index;
                if 0 <= target_bone_index && target_bone_index < bone_arena.len() as i32 {
                    let append_transform_solver = AppendTransformSolver::new(
                        target_bone_index as u32,
                        metadata.flag,
                        append_transform.ratio,
                    );
                    let bone = &mut bone_arena[i as usize];
                    bone.append_transform_solver = Some(append_transform_solver_arena.len() as u32);
                    append_transform_solver_arena.push(append_transform_solver);
                } else {
                    // todo diagnostic
                    panic!();
                }
            }

            if let Some(ik) = metadata.ik {
                if 0 <= ik.target && ik.target < bone_arena.len() as i32 {
                    let mut ik_solver = IkSolver::new(
                        ik.iteration,
                        ik.rotation_constraint,
                        i,
                        ik.target as u32,
                        ik.links.len() as u32,
                    );

                    for link in ik.links {
                        if 0 <= link.target && link.target < bone_arena.len() as i32 {
                            ik_solver.add_ik_chain(
                                UncheckedSliceMut::new(&mut bone_arena),
                                link.target as u32,
                                link.limits,
                            );
                        } else {
                            // todo diagnostic
                            panic!();
                        }
                    }
                    bone_arena[i as usize].ik_solver = Some(ik_solver_arena.len() as u32);
                    ik_solver_arena.push(ik_solver);
                } else {
                    // todo diagnostic
                    panic!();
                }
            }
        });
    
        let (morphs, reader) = reader.read();
        let animation_arena = AnimationArena::new(&bone_arena, ik_solver_arena.len() as u32, morphs.len() as u32);
        let morph_controller = MmdMorphController::new(morphs.into_boxed_slice());

        let reader = reader.for_each(|_metadata| {
            // todo add physics
        });

        reader.for_each(|_metadata| {
            // todo add physics
        });

        let mut sorted_runtime_bones = Vec::with_capacity(bone_arena.len());
        for i in 0..bone_arena.len() as u32 {
            sorted_runtime_bones.push(i);
        }
        sorted_runtime_bones.sort_by(|a, b| {
            let a = &bone_arena[(*a) as usize];
            let b = &bone_arena[(*b) as usize];
            a.transform_order.cmp(&b.transform_order)
        });

        let mut sorted_runtime_root_bones = Vec::with_capacity(bone_arena.len());
        for i in 0..bone_arena.len() as u32 {
            let bone = &bone_arena[sorted_runtime_bones[i as usize] as usize];
            if bone.parent_bone.is_none() {
                sorted_runtime_root_bones.push(i);
            }
        }

        let mut bone_max_depth = 0;
        for root in sorted_runtime_root_bones.iter() {
            fn calc_depth(bone_arena: &[MmdRuntimeBone], bone: u32, depth: u32) -> u32 {
                let bone = &bone_arena[bone as usize];
                let mut max_depth = depth;
                for child_bone in &bone.child_bones {
                    max_depth = max_depth.max(calc_depth(bone_arena, *child_bone, depth + 1));
                }
                max_depth
            }
            bone_max_depth = bone_max_depth.max(calc_depth(&bone_arena, sorted_runtime_bones[(*root) as usize], 1));
        }

        MmdModel {
            runtime_animation: None,
            animation_arena,
            bone_arena: MmdRuntimeBoneArena::new(bone_arena, Vec::with_capacity(bone_max_depth as usize)),
            append_transform_solver_arena: AppendTransformSolverArena::new(append_transform_solver_arena.into_boxed_slice()),
            ik_solver_arena: IkSolverArena::new(ik_solver_arena.into_boxed_slice()),
            morph_controller,
            sorted_runtime_bones: sorted_runtime_bones.into_boxed_slice(),
            sorted_runtime_root_bones: sorted_runtime_root_bones.into_boxed_slice(),
        }
    }

    #[inline]
    pub(crate) fn runtime_animation_mut(&mut self) -> &mut Option<NonNull<MmdRuntimeAnimation>> {
        unsafe {
            std::mem::transmute(&mut self.runtime_animation)
        }
    }

    #[inline]
    pub(crate) fn animation_arena_mut(&mut self) -> &mut AnimationArena {
        &mut self.animation_arena
    }

    #[inline]
    pub(crate) fn bone_arena_mut(&mut self) -> &mut MmdRuntimeBoneArena {
        &mut self.bone_arena
    }

    pub(crate) fn before_physics(&mut self, frame_time: Option<f32>) {
        if let Some(frame_time) = frame_time {
            if let Some(runtime_animation) = self.runtime_animation {
                let runtime_animation: &mut MmdRuntimeAnimation = unsafe {
                    std::mem::transmute(runtime_animation)
                };
                runtime_animation.animate(frame_time, self);
            }
        }

        #[cfg(debug_assertions)]
        {
            let animation_bone_arena = &mut self.animation_arena_mut().bone_arena_mut();
            for i in 0..animation_bone_arena.len() as u32 {
                let bone_animation = &mut animation_bone_arena[i];
                bone_animation.rotation = bone_animation.rotation.normalize();
            }
        }

        self.morph_controller.update(&mut self.bone_arena, self.animation_arena.morph_arena());
        self.update(false);
    }

    pub(crate) fn after_physics(&mut self) {
        self.update(true);
    }

    pub(crate) fn update_local_matrices(&mut self) {
        for bone in self.sorted_runtime_bones.iter() {
            let bone = &mut self.bone_arena.arena_mut()[*bone];
            bone.update_local_matrix(&self.animation_arena, &self.append_transform_solver_arena);
        }
    }

    fn update(&mut self, after_physics_stage: bool) {
        for bone in self.sorted_runtime_bones.iter() {
            let bone = &mut self.bone_arena.arena_mut()[*bone];
            if bone.transform_after_physics != after_physics_stage {
                continue;
            }

            bone.update_local_matrix(&self.animation_arena, &self.append_transform_solver_arena);
        }

        for i in 0..self.sorted_runtime_root_bones.len() {
            let bone_index = self.sorted_runtime_root_bones[i];
            let bone = &self.bone_arena.arena()[bone_index];
            if bone.transform_after_physics != after_physics_stage {
                continue;
            }

            self.bone_arena.update_world_matrix(bone_index);
        }

        for i in 0..self.sorted_runtime_bones.len() {
            let bone_index = self.sorted_runtime_bones[i];
            let bone = &self.bone_arena.arena()[bone_index];
            if bone.transform_after_physics != after_physics_stage {
                continue;
            }

            if let Some(append_transform_solver) = bone.append_transform_solver {
                self.append_transform_solver_arena.update(append_transform_solver, &self.animation_arena, &self.bone_arena);
                let bone = &mut self.bone_arena.arena_mut()[bone_index];
                bone.update_local_matrix(&self.animation_arena, &self.append_transform_solver_arena);
                self.bone_arena.update_world_matrix(bone_index);
            }

            let bone = &self.bone_arena.arena()[bone_index];
            if let Some(ik_solver) = bone.ik_solver {
                if self.animation_arena.iksolver_state_arena()[ik_solver] != 0 {
                    let ik_solver = &mut self.ik_solver_arena.arena_mut()[ik_solver];
                    ik_solver.solve(&self.animation_arena, &mut self.bone_arena, &self.append_transform_solver_arena);
                    self.bone_arena.update_world_matrix(bone_index);
                }
            }
        }

        for i in 0..self.sorted_runtime_root_bones.len() {
            let bone_index = self.sorted_runtime_root_bones[i];
            let bone = &self.bone_arena.arena()[bone_index];
            if bone.transform_after_physics != after_physics_stage {
                continue;
            }

            self.bone_arena.update_world_matrix(bone_index);
        }
    }
}
