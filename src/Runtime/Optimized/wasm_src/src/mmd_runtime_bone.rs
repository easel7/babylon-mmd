use nalgebra::{Vector3, UnitQuaternion, Matrix4 };

use crate::{animation_arena::AnimationArena, append_transform_solver::AppendTransformSolverArena};

pub(crate) struct MmdRuntimeBoneArena {
    arena: Box<[MmdRuntimeBone]>,
    bone_stack: Vec<usize>,
}

impl MmdRuntimeBoneArena {
    pub fn new(area: Box<[MmdRuntimeBone]>, bone_stack: Vec<usize>) -> Self {
        MmdRuntimeBoneArena {
            arena: area,
            bone_stack,
        }
    }

    pub fn update_world_matrix(&mut self, root: usize) {
        let stack = &mut self.bone_stack;
        stack.push(root);

        while let Some(bone) = stack.pop() {
            if let Some(parent_bone) = self.arena[bone].parent_bone {
                let parent_world_matrix = self.arena[parent_bone].world_matrix;

                let bone = &mut self.arena[bone];
                bone.world_matrix = parent_world_matrix * bone.local_matrix;
            } else {
                let bone = &mut self.arena[bone];
                bone.world_matrix = bone.local_matrix;
            }

            let bone = &self.arena[bone];
            for child_bone in &bone.child_bones {
                stack.push(*child_bone);
            }
        }
    }
}

impl std::ops::Deref for MmdRuntimeBoneArena {
    type Target = [MmdRuntimeBone];

    fn deref(&self) -> &Self::Target {
        &self.arena
    }
}

impl std::ops::DerefMut for MmdRuntimeBoneArena {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.arena
    }
}

pub(crate) struct MmdRuntimeBone {
    pub rest_position: Vector3<f32>,
    index: usize,

    pub parent_bone: Option<usize>,
    pub child_bones: Vec<usize>,
    pub transform_order: i32,
    pub transform_after_physics: bool,

    pub append_transform_solver: Option<usize>,
    pub ik_solver: Option<usize>,

    pub morph_position_offset: Option<Vector3<f32>>,
    pub morph_rotation_offset: Option<UnitQuaternion<f32>>,

    pub ik_rotation: Option<UnitQuaternion<f32>>,

    pub local_matrix: Matrix4<f32>,
    pub world_matrix: Matrix4<f32>,
}

impl MmdRuntimeBone {
    pub fn new(index: usize) -> Self {
        MmdRuntimeBone {
            rest_position: Vector3::zeros(),
            index,
            
            parent_bone: None,
            child_bones: Vec::new(),
            transform_order: 0,
            transform_after_physics: false,

            append_transform_solver: None,
            ik_solver: None,

            morph_position_offset: None,
            morph_rotation_offset: None,

            ik_rotation: None,

            local_matrix: Matrix4::identity(),
            world_matrix: Matrix4::identity(),
        }
    }

    pub fn animated_position(&self, animation_arena: &AnimationArena) -> Vector3<f32> {
        let mut position = animation_arena.nth_bone_position(self.index);
        if let Some(morph_position_offset) = self.morph_position_offset {
            position += morph_position_offset;
        }
        position
    }

    pub fn animated_rotation(&self, animation_arena: &AnimationArena) -> UnitQuaternion<f32> {
        let mut rotation = animation_arena.nth_bone_rotation(self.index);
        if let Some(morph_rotation_offset) = self.morph_rotation_offset {
            rotation *= morph_rotation_offset;
        }
        rotation
    }

    pub fn animation_position_offset(&self) -> Vector3<f32> {
        let mut position = Vector3::zeros();
        if let Some(morph_position_offset) = self.morph_position_offset {
            position += morph_position_offset;
        }
        position - self.rest_position
    }

    pub fn update_local_matrix(&mut self, animation_arena: &AnimationArena, append_transform_solver_arena: &AppendTransformSolverArena) {
        let mut rotation = self.animated_rotation(animation_arena);
        if let Some(ik_rotation) = self.ik_rotation {
            rotation = ik_rotation * rotation;
        }

        let mut position = self.animated_position(animation_arena);
        
        if let Some(append_transform_solver) = self.append_transform_solver {
            let append_transform_solver = &append_transform_solver_arena[append_transform_solver];

            if append_transform_solver.is_affect_rotation() {
                rotation *= append_transform_solver.append_rotation_offset();
            }
            if append_transform_solver.is_affect_position() {
                position += append_transform_solver.append_position_offset();
            }
        }

        self.local_matrix = 
            Matrix4::new_translation(&position) *
            rotation.to_homogeneous() *
            Matrix4::new_nonuniform_scaling(&animation_arena.nth_bone_scale(self.index));
    }
}
