use serde::{Deserialize, Serialize};
use std::{fmt, io::Read};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
pub const MAX_MANIFEST_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_MESH_BATCH_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrameHeader {
    pub protocol_version: u16,
    pub session_id: String,
    pub sequence: u64,
    pub payload_length: u64,
    #[serde(flatten)]
    pub event: WorkerEvent,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkerEvent {
    Manifest {
        root_count: u64,
        shell_count: u64,
    },
    Progress {
        stage: ProgressStage,
        completed: u64,
        total: u64,
    },
    MeshBatch {
        batch_id: String,
        node_id: String,
        face_count: u64,
        colored_face_count: u64,
        vertex_count: u64,
        triangle_count: u64,
        encoding: MeshEncoding,
    },
    Terminal {
        status: TerminalStatus,
        message: Option<String>,
    },
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProgressStage {
    Reading,
    Transferring,
    Tessellating,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum MeshEncoding {
    Kea3dMeshV1,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStatus {
    Success,
    Cancelled,
    Failure,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostCommand {
    pub protocol_version: u16,
    pub session_id: String,
    pub command: HostCommandKind,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HostCommandKind {
    Cancel,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Frame {
    pub header: FrameHeader,
    pub payload: Vec<u8>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ProtocolError {
    Io(String),
    InvalidHeader(String),
    HeaderTooLarge(usize),
    PayloadTooLarge(u64),
    VersionMismatch { expected: u16, received: u16 },
    SessionMismatch,
    UnexpectedSequence { expected: u64, received: u64 },
    InvalidEvent(String),
    EventAfterTerminal,
}

#[derive(Debug, PartialEq, Eq)]
pub struct MeshPayloadMetadata {
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub group_count: u32,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(message) => {
                write!(formatter, "Could not read the CAD worker stream: {message}")
            }
            Self::InvalidHeader(message) => {
                write!(formatter, "Invalid CAD worker header: {message}")
            }
            Self::HeaderTooLarge(bytes) => {
                write!(
                    formatter,
                    "CAD worker header exceeds {MAX_HEADER_BYTES} bytes: {bytes}"
                )
            }
            Self::PayloadTooLarge(bytes) => {
                write!(
                    formatter,
                    "CAD worker payload exceeds the event limit: {bytes}"
                )
            }
            Self::VersionMismatch { expected, received } => write!(
                formatter,
                "CAD worker protocol version mismatch: expected {expected}, received {received}"
            ),
            Self::SessionMismatch => write!(formatter, "CAD worker session ID does not match"),
            Self::UnexpectedSequence { expected, received } => write!(
                formatter,
                "CAD worker event sequence mismatch: expected {expected}, received {received}"
            ),
            Self::InvalidEvent(message) => write!(formatter, "Invalid CAD worker event: {message}"),
            Self::EventAfterTerminal => {
                write!(formatter, "CAD worker sent an event after termination")
            }
        }
    }
}

impl std::error::Error for ProtocolError {}

pub fn read_frame(reader: &mut impl Read) -> Result<Option<Frame>, ProtocolError> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1]) {
        Ok(0) => return Ok(None),
        Ok(1) => {}
        Ok(_) => unreachable!(),
        Err(error) => return Err(ProtocolError::Io(error.to_string())),
    }
    reader
        .read_exact(&mut length_bytes[1..])
        .map_err(|error| ProtocolError::Io(error.to_string()))?;

    let header_length = u32::from_le_bytes(length_bytes) as usize;
    if header_length == 0 || header_length > MAX_HEADER_BYTES {
        return Err(ProtocolError::HeaderTooLarge(header_length));
    }

    let mut header_bytes = vec![0_u8; header_length];
    reader
        .read_exact(&mut header_bytes)
        .map_err(|error| ProtocolError::Io(error.to_string()))?;
    let header = serde_json::from_slice::<FrameHeader>(&header_bytes)
        .map_err(|error| ProtocolError::InvalidHeader(error.to_string()))?;

    let payload_limit = match &header.event {
        WorkerEvent::Manifest { .. } => MAX_MANIFEST_BYTES as u64,
        WorkerEvent::MeshBatch { .. } => MAX_MESH_BATCH_BYTES as u64,
        WorkerEvent::Progress { .. } | WorkerEvent::Terminal { .. } => 0,
    };
    if header.payload_length > payload_limit {
        return Err(ProtocolError::PayloadTooLarge(header.payload_length));
    }
    let payload_length = usize::try_from(header.payload_length)
        .map_err(|_| ProtocolError::PayloadTooLarge(header.payload_length))?;
    let mut payload = vec![0_u8; payload_length];
    reader
        .read_exact(&mut payload)
        .map_err(|error| ProtocolError::Io(error.to_string()))?;

    Ok(Some(Frame { header, payload }))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, ProtocolError> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| ProtocolError::InvalidEvent("mesh payload is truncated".to_owned()))?;
    Ok(u32::from_le_bytes(value.try_into().unwrap()))
}

fn read_f32(bytes: &[u8], offset: usize) -> Result<f32, ProtocolError> {
    Ok(f32::from_bits(read_u32(bytes, offset)?))
}

pub fn validate_mesh_payload(frame: &Frame) -> Result<MeshPayloadMetadata, ProtocolError> {
    let WorkerEvent::MeshBatch {
        vertex_count: declared_vertices,
        triangle_count: declared_triangles,
        encoding: MeshEncoding::Kea3dMeshV1,
        ..
    } = &frame.header.event
    else {
        return Err(ProtocolError::InvalidEvent(
            "frame is not a kea3d-mesh-v1 batch".to_owned(),
        ));
    };
    if frame.payload.get(0..4) != Some(b"K3M1") {
        return Err(ProtocolError::InvalidEvent(
            "mesh payload has an invalid signature".to_owned(),
        ));
    }

    let vertex_count = read_u32(&frame.payload, 4)?;
    let triangle_count = read_u32(&frame.payload, 8)?;
    let group_count = read_u32(&frame.payload, 12)?;
    if vertex_count == 0
        || triangle_count == 0
        || u64::from(vertex_count) != *declared_vertices
        || u64::from(triangle_count) != *declared_triangles
    {
        return Err(ProtocolError::InvalidEvent(
            "mesh payload counts do not match the frame header".to_owned(),
        ));
    }

    let vectors_bytes = usize::try_from(vertex_count)
        .ok()
        .and_then(|count| count.checked_mul(3)?.checked_mul(4))
        .ok_or_else(|| ProtocolError::InvalidEvent("mesh vector count overflows".to_owned()))?;
    let indices_bytes = usize::try_from(triangle_count)
        .ok()
        .and_then(|count| count.checked_mul(3)?.checked_mul(4))
        .ok_or_else(|| ProtocolError::InvalidEvent("mesh index count overflows".to_owned()))?;
    let groups_bytes = usize::try_from(group_count)
        .ok()
        .and_then(|count| count.checked_mul(24))
        .ok_or_else(|| ProtocolError::InvalidEvent("mesh group count overflows".to_owned()))?;
    let expected_length = 16_usize
        .checked_add(vectors_bytes)
        .and_then(|length| length.checked_add(vectors_bytes))
        .and_then(|length| length.checked_add(indices_bytes))
        .and_then(|length| length.checked_add(groups_bytes))
        .ok_or_else(|| ProtocolError::InvalidEvent("mesh payload length overflows".to_owned()))?;
    if frame.payload.len() != expected_length {
        return Err(ProtocolError::InvalidEvent(
            "mesh payload length does not match its counts".to_owned(),
        ));
    }

    let positions_offset = 16;
    let normals_offset = positions_offset + vectors_bytes;
    let indices_offset = normals_offset + vectors_bytes;
    let groups_offset = indices_offset + indices_bytes;
    for offset in (positions_offset..indices_offset).step_by(4) {
        if !read_f32(&frame.payload, offset)?.is_finite() {
            return Err(ProtocolError::InvalidEvent(
                "mesh vectors must contain finite values".to_owned(),
            ));
        }
    }
    for offset in (indices_offset..groups_offset).step_by(4) {
        if read_u32(&frame.payload, offset)? >= vertex_count {
            return Err(ProtocolError::InvalidEvent(
                "mesh index is outside the vertex range".to_owned(),
            ));
        }
    }

    let mut covered_triangles = 0_u32;
    for group in 0..group_count as usize {
        let offset = groups_offset + group * 24;
        let first_triangle = read_u32(&frame.payload, offset)?;
        let group_triangles = read_u32(&frame.payload, offset + 4)?;
        if first_triangle != covered_triangles || group_triangles == 0 {
            return Err(ProtocolError::InvalidEvent(
                "mesh color groups must be contiguous and non-empty".to_owned(),
            ));
        }
        covered_triangles = covered_triangles
            .checked_add(group_triangles)
            .ok_or_else(|| {
                ProtocolError::InvalidEvent("mesh color group range overflows".to_owned())
            })?;
        for color_offset in [8, 12, 16, 20] {
            let color = read_f32(&frame.payload, offset + color_offset)?;
            if !color.is_finite() || !(0.0..=1.0).contains(&color) {
                return Err(ProtocolError::InvalidEvent(
                    "mesh colors must be finite normalized values".to_owned(),
                ));
            }
        }
    }
    if covered_triangles != triangle_count {
        return Err(ProtocolError::InvalidEvent(
            "mesh color groups must cover every triangle".to_owned(),
        ));
    }

    Ok(MeshPayloadMetadata {
        vertex_count,
        triangle_count,
        group_count,
    })
}

#[derive(Debug)]
pub struct SessionTracker {
    session_id: String,
    next_sequence: u64,
    manifest_seen: bool,
    worker_terminal_status: Option<TerminalStatus>,
    final_status: Option<TerminalStatus>,
}

impl SessionTracker {
    pub fn new(session_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            next_sequence: 1,
            manifest_seen: false,
            worker_terminal_status: None,
            final_status: None,
        }
    }

    pub fn accept(&mut self, frame: &Frame) -> Result<(), ProtocolError> {
        if self.worker_terminal_status.is_some() || self.final_status.is_some() {
            return Err(ProtocolError::EventAfterTerminal);
        }
        if frame.header.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                received: frame.header.protocol_version,
            });
        }
        if frame.header.session_id != self.session_id {
            return Err(ProtocolError::SessionMismatch);
        }
        if frame.header.sequence != self.next_sequence {
            return Err(ProtocolError::UnexpectedSequence {
                expected: self.next_sequence,
                received: frame.header.sequence,
            });
        }
        if frame.header.payload_length != frame.payload.len() as u64 {
            return Err(ProtocolError::InvalidEvent(
                "declared payload length does not match the frame".to_owned(),
            ));
        }

        match &frame.header.event {
            WorkerEvent::Manifest { .. } => {
                if self.manifest_seen || frame.payload.is_empty() {
                    return Err(ProtocolError::InvalidEvent(
                        "manifest must occur once and contain a payload".to_owned(),
                    ));
                }
                self.manifest_seen = true;
            }
            WorkerEvent::Progress {
                completed, total, ..
            } => {
                if *total == 0 || completed > total || !frame.payload.is_empty() {
                    return Err(ProtocolError::InvalidEvent(
                        "progress must be bounded and cannot contain a payload".to_owned(),
                    ));
                }
            }
            WorkerEvent::MeshBatch {
                batch_id,
                node_id,
                face_count,
                colored_face_count,
                ..
            } => {
                if !self.manifest_seen
                    || batch_id.is_empty()
                    || node_id.is_empty()
                    || *face_count == 0
                    || colored_face_count > face_count
                    || frame.payload.is_empty()
                {
                    return Err(ProtocolError::InvalidEvent(
                        "mesh batches require a manifest, identifiers, and a payload".to_owned(),
                    ));
                }
            }
            WorkerEvent::Terminal { status, message } => {
                if !frame.payload.is_empty()
                    || (*status == TerminalStatus::Success && !self.manifest_seen)
                    || (*status == TerminalStatus::Failure
                        && message.as_deref().map_or(true, str::is_empty))
                {
                    return Err(ProtocolError::InvalidEvent(
                        "terminal event is inconsistent with the session state".to_owned(),
                    ));
                }
                self.worker_terminal_status = Some(*status);
            }
        }

        self.next_sequence += 1;
        Ok(())
    }

    pub fn finalize_after_exit(
        &mut self,
        cancellation_requested: bool,
        exit_success: bool,
    ) -> TerminalStatus {
        if let Some(status) = self.final_status {
            return status;
        }

        let status = if cancellation_requested {
            TerminalStatus::Cancelled
        } else {
            match self.worker_terminal_status {
                Some(TerminalStatus::Success) if exit_success => TerminalStatus::Success,
                Some(TerminalStatus::Cancelled) => TerminalStatus::Cancelled,
                Some(TerminalStatus::Failure) | Some(TerminalStatus::Success) | None => {
                    TerminalStatus::Failure
                }
            }
        };
        self.final_status = Some(status);
        status
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frame(sequence: u64, event: WorkerEvent, payload: Vec<u8>) -> Frame {
        Frame {
            header: FrameHeader {
                protocol_version: PROTOCOL_VERSION,
                session_id: "session-1".to_owned(),
                sequence,
                payload_length: payload.len() as u64,
                event,
            },
            payload,
        }
    }

    fn encode(frame: &Frame) -> Vec<u8> {
        let header = serde_json::to_vec(&frame.header).unwrap();
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&header);
        bytes.extend_from_slice(&frame.payload);
        bytes
    }

    fn append_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn append_f32(bytes: &mut Vec<u8>, value: f32) {
        append_u32(bytes, value.to_bits());
    }

    fn triangle_payload() -> Vec<u8> {
        let mut payload = b"K3M1".to_vec();
        append_u32(&mut payload, 3);
        append_u32(&mut payload, 1);
        append_u32(&mut payload, 1);
        for value in [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0] {
            append_f32(&mut payload, value);
        }
        for _ in 0..3 {
            for value in [0.0, 0.0, 1.0] {
                append_f32(&mut payload, value);
            }
        }
        for index in 0..3 {
            append_u32(&mut payload, index);
        }
        append_u32(&mut payload, 0);
        append_u32(&mut payload, 1);
        for value in [0.2, 0.4, 0.6, 1.0] {
            append_f32(&mut payload, value);
        }
        payload
    }

    #[test]
    fn reads_a_bounded_binary_frame() {
        let original = frame(
            1,
            WorkerEvent::Manifest {
                root_count: 1,
                shell_count: 99,
            },
            br#"{"root":{"id":"root"}}"#.to_vec(),
        );
        let mut cursor = Cursor::new(encode(&original));

        assert_eq!(read_frame(&mut cursor).unwrap(), Some(original));
        assert_eq!(read_frame(&mut cursor).unwrap(), None);
    }

    #[test]
    fn rejects_an_oversized_header_before_allocation() {
        let mut bytes = ((MAX_HEADER_BYTES + 1) as u32).to_le_bytes().to_vec();
        bytes.extend_from_slice(b"ignored");

        assert_eq!(
            read_frame(&mut Cursor::new(bytes)).unwrap_err(),
            ProtocolError::HeaderTooLarge(MAX_HEADER_BYTES + 1)
        );
    }

    #[test]
    fn enforces_manifest_mesh_and_single_terminal_ordering() {
        let mut tracker = SessionTracker::new("session-1");
        let manifest = frame(
            1,
            WorkerEvent::Manifest {
                root_count: 1,
                shell_count: 99,
            },
            vec![1],
        );
        let mesh = frame(
            2,
            WorkerEvent::MeshBatch {
                batch_id: "shell-0001".to_owned(),
                node_id: "root".to_owned(),
                face_count: 188,
                colored_face_count: 188,
                vertex_count: 10_000,
                triangle_count: 11_878,
                encoding: MeshEncoding::Kea3dMeshV1,
            },
            vec![2, 3, 4],
        );
        let terminal = frame(
            3,
            WorkerEvent::Terminal {
                status: TerminalStatus::Success,
                message: None,
            },
            Vec::new(),
        );

        tracker.accept(&manifest).unwrap();
        tracker.accept(&mesh).unwrap();
        tracker.accept(&terminal).unwrap();
        assert_eq!(
            tracker.accept(&terminal),
            Err(ProtocolError::EventAfterTerminal)
        );
        assert_eq!(
            tracker.finalize_after_exit(false, true),
            TerminalStatus::Success
        );
        assert_eq!(
            tracker.finalize_after_exit(false, false),
            TerminalStatus::Success
        );
    }

    #[test]
    fn rejects_mesh_before_manifest_and_sequence_gaps() {
        let mesh = frame(
            1,
            WorkerEvent::MeshBatch {
                batch_id: "shell-0001".to_owned(),
                node_id: "root".to_owned(),
                face_count: 1,
                colored_face_count: 1,
                vertex_count: 3,
                triangle_count: 1,
                encoding: MeshEncoding::Kea3dMeshV1,
            },
            vec![1],
        );
        assert!(matches!(
            SessionTracker::new("session-1").accept(&mesh),
            Err(ProtocolError::InvalidEvent(_))
        ));

        let progress = frame(
            2,
            WorkerEvent::Progress {
                stage: ProgressStage::Reading,
                completed: 1,
                total: 10,
            },
            Vec::new(),
        );
        assert_eq!(
            SessionTracker::new("session-1").accept(&progress),
            Err(ProtocolError::UnexpectedSequence {
                expected: 1,
                received: 2,
            })
        );
    }

    #[test]
    fn serializes_a_versioned_cancel_command() {
        let command = HostCommand {
            protocol_version: PROTOCOL_VERSION,
            session_id: "session-1".to_owned(),
            command: HostCommandKind::Cancel,
        };

        assert_eq!(
            serde_json::to_string(&command).unwrap(),
            r#"{"protocolVersion":1,"sessionId":"session-1","command":"cancel"}"#
        );
    }

    #[test]
    fn host_owns_the_final_status_after_worker_exit() {
        let mut cancelled = SessionTracker::new("session-1");
        assert_eq!(
            cancelled.finalize_after_exit(true, false),
            TerminalStatus::Cancelled
        );

        let mut crashed_after_success = SessionTracker::new("session-1");
        crashed_after_success
            .accept(&frame(
                1,
                WorkerEvent::Manifest {
                    root_count: 1,
                    shell_count: 1,
                },
                vec![1],
            ))
            .unwrap();
        crashed_after_success
            .accept(&frame(
                2,
                WorkerEvent::Terminal {
                    status: TerminalStatus::Success,
                    message: None,
                },
                Vec::new(),
            ))
            .unwrap();
        assert_eq!(
            crashed_after_success.finalize_after_exit(false, false),
            TerminalStatus::Failure
        );
    }

    #[test]
    fn validates_the_frozen_mesh_layout() {
        let payload = triangle_payload();
        let mesh = frame(
            1,
            WorkerEvent::MeshBatch {
                batch_id: "shell-0001".to_owned(),
                node_id: "root".to_owned(),
                face_count: 1,
                colored_face_count: 1,
                vertex_count: 3,
                triangle_count: 1,
                encoding: MeshEncoding::Kea3dMeshV1,
            },
            payload,
        );

        assert_eq!(
            validate_mesh_payload(&mesh).unwrap(),
            MeshPayloadMetadata {
                vertex_count: 3,
                triangle_count: 1,
                group_count: 1,
            }
        );
    }

    #[test]
    fn rejects_out_of_range_mesh_indices() {
        let mut payload = triangle_payload();
        let first_index_offset = 16 + 3 * 3 * 4 * 2;
        payload[first_index_offset..first_index_offset + 4].copy_from_slice(&3_u32.to_le_bytes());
        let mesh = frame(
            1,
            WorkerEvent::MeshBatch {
                batch_id: "shell-0001".to_owned(),
                node_id: "root".to_owned(),
                face_count: 1,
                colored_face_count: 1,
                vertex_count: 3,
                triangle_count: 1,
                encoding: MeshEncoding::Kea3dMeshV1,
            },
            payload,
        );

        assert!(matches!(
            validate_mesh_payload(&mesh),
            Err(ProtocolError::InvalidEvent(_))
        ));
    }
}
