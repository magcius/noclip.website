use nalgebra_glm::{vec3, vec4, Vec3, Vec4};

fn get_coeff_bezier(p0: f32, p1: f32, p2: f32, p3: f32) -> Vec4 {
    vec4(
        (p0 * -1.0) + (p1 *  3.0) + (p2 * -3.0) +  (p3 *  1.0),
        (p0 *  3.0) + (p1 * -6.0) + (p2 *  3.0) +  (p3 *  0.0),
        (p0 * -3.0) + (p1 *  3.0) + (p2 *  0.0) +  (p3 *  0.0),
        (p0 *  1.0) + (p1 *  0.0) + (p2 *  0.0) +  (p3 *  0.0),
    )
}

pub fn get_point_bezier(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let v = get_coeff_bezier(p0, p1, p2, p3);
    return get_point_cubic(v, t);
}

pub fn get_derivative_bezier(p0: f32, p1: f32, p2: f32, p3: f32, t: f32) -> f32 {
    let v = get_coeff_bezier(p0, p1, p2, p3);
    return get_derivative_cubic(v, t);
}

pub fn get_point_cubic(cf: Vec4, t: f32) -> f32 {
    return ((cf[0] * t + cf[1]) * t + cf[2]) * t + cf[3];
}

pub fn get_derivative_cubic(cf: Vec4, t: f32) -> f32 {
    return (3.0 * cf[0] * t + 2.0 * cf[1]) * t + cf[2];
}

#[derive(Debug, Clone)]
pub struct BezierSpline {
    pub points: Vec<Vec3>,
    pub total_length: Option<f32>,
    pub segment_lengths: Option<Vec<f32>>,
}

impl BezierSpline {
    pub fn new(points: Vec<Vec3>) -> Self {
        let mut spline = BezierSpline {
            points,
            total_length: None,
            segment_lengths: None,
        };
        spline.calculate_segment_lengths();
        spline
    }

    fn calculate_segment_lengths(&mut self) {
        let mut segment_lengths = Vec::new();
        let mut total_length = 0.0;
        let num_segments = (self.points.len() - 1) / 3;
        let iterations_per_segment = 20;
        let dt = 1.0 / iterations_per_segment as f32;
        let mut last_pos = self.evaluate_segment(0, 0.0);
        let mut curr_pos;

        for segment in 0..num_segments {
            let mut length = 0.0;

            let mut t = dt;
            for _ in 0..iterations_per_segment {
                curr_pos = self.evaluate_segment(segment, t);
                length += curr_pos.metric_distance(&last_pos);
                last_pos = curr_pos;
                t += dt;
            }
            segment_lengths.push(length);
            total_length += length;
        }

        self.segment_lengths = Some(segment_lengths);
        self.total_length = Some(total_length);
    }

    pub fn calculate_paramateric_spline(&self, t: f32) -> Vec3 {
        assert!(t >= 0.0 && t <= 1.0);
        let (segment, segment_t) = self.find_parametric_segment(t);
        self.evaluate_segment(segment, segment_t)
    }

    pub fn calculate_parametric_spline_derivative(&self, t: f32) -> Vec3 {
        assert!(t >= 0.0 && t <= 1.0);
        let (segment, segment_t) = self.find_parametric_segment(t);
        self.evaluate_derivative(segment, segment_t)
    }

    fn segment_len(&self, i: usize) -> f32 {
        self.segment_lengths.as_ref().expect("spline uninitialized")[i]
    }

    fn find_parametric_segment(&self, t: f32) -> (usize, f32) {
        let target_length = t * self.total_length.expect("spline uninitialized");
        let mut length = 0.0;
        let num_segments = (self.points.len() - 1) / 3;
        for segment in 0..num_segments {
            let segment_length = self.segment_len(segment);
            if length + segment_length < target_length {
                length += segment_length;
            } else {
                let segment_t = (target_length - length) / segment_length;
                return (segment, segment_t);
            }
        }
        panic!("failed to find spline segment for parametric t={}", t);
    }

    fn evaluate_derivative(&self, segment: usize, t: f32) -> Vec3 {
        let p0 = self.points[segment * 3 + 0];
        let p1 = self.points[segment * 3 + 1];
        let p2 = self.points[segment * 3 + 2];
        let p3 = self.points[segment * 3 + 3];
        vec3(
            get_derivative_bezier(p0[0], p1[0], p2[0], p3[0], t),
            get_derivative_bezier(p0[1], p1[1], p2[1], p3[1], t),
            get_derivative_bezier(p0[2], p1[2], p2[2], p3[2], t),
        )
    }

    fn evaluate_segment(&self, segment: usize, t: f32) -> Vec3 {
        let p0 = self.points[segment * 3 + 0];
        let p1 = self.points[segment * 3 + 1];
        let p2 = self.points[segment * 3 + 2];
        let p3 = self.points[segment * 3 + 3];
        vec3(
            get_point_bezier(p0[0], p1[0], p2[0], p3[0], t),
            get_point_bezier(p0[1], p1[1], p2[1], p3[1], t),
            get_point_bezier(p0[2], p1[2], p2[2], p3[2], t),
        )
    }
}
