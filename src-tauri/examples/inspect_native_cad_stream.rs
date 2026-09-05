use kea3d_lib::native_cad_protocol::{
    read_frame, validate_mesh_payload, SessionTracker, WorkerEvent,
};
use std::{env, fs::File, process::ExitCode};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = env::args().skip(1);
    let path = arguments
        .next()
        .ok_or("usage: inspect_native_cad_stream <capture.bin> <session-id>")?;
    let session_id = arguments
        .next()
        .ok_or("usage: inspect_native_cad_stream <capture.bin> <session-id>")?;
    if arguments.next().is_some() {
        return Err("usage: inspect_native_cad_stream <capture.bin> <session-id>".into());
    }

    let mut input = File::open(path)?;
    let mut tracker = SessionTracker::new(session_id);
    let mut frames = 0_u64;
    let mut manifests = 0_u64;
    let mut batches = 0_u64;
    let mut faces = 0_u64;
    let mut colored_faces = 0_u64;
    let mut vertices = 0_u64;
    let mut triangles = 0_u64;
    let mut color_groups = 0_u64;
    let mut last_progress = None;
    let mut terminal = None;
    while let Some(frame) = read_frame(&mut input)? {
        tracker.accept(&frame)?;
        frames += 1;
        match &frame.header.event {
            WorkerEvent::Manifest { .. } => {
                serde_json::from_slice::<serde_json::Value>(&frame.payload)?;
                manifests += 1;
            }
            WorkerEvent::MeshBatch {
                face_count,
                colored_face_count,
                ..
            } => {
                let metadata = validate_mesh_payload(&frame)?;
                batches += 1;
                faces += face_count;
                colored_faces += colored_face_count;
                vertices += u64::from(metadata.vertex_count);
                triangles += u64::from(metadata.triangle_count);
                color_groups += u64::from(metadata.group_count);
            }
            WorkerEvent::Progress {
                stage,
                completed,
                total,
            } => {
                last_progress = Some(format!("{stage:?}:{completed}/{total}"));
            }
            WorkerEvent::Terminal { status, message } => {
                terminal = Some(format!(
                    "{status:?}:{}",
                    message.as_deref().unwrap_or_default()
                ));
            }
        }
    }

    println!(
        "frames={frames} manifests={manifests} batches={batches} faces={faces} colored_faces={colored_faces} vertices={vertices} triangles={triangles} color_groups={color_groups} last_progress={} terminal={}",
        last_progress.as_deref().unwrap_or("none"),
        terminal.as_deref().unwrap_or("none")
    );
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
