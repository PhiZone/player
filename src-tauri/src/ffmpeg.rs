use std::process::{Command, ChildStdin};
use std::io::Write;
use std::sync::{LazyLock, Mutex};

static FFMPEG_STDIN: LazyLock<Mutex<Option<ChildStdin>>> = LazyLock::new(|| Mutex::new(None));

pub fn setup_video(resolution: String, fps: u32, codec: String) -> Result<(), String> {
    let mut command = Command::new("ffmpeg");
    command.args(&[
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        &resolution,
        "-r",
        &fps.to_string(),
        "-i",
        "-",
        "-c:v",
        &codec,
        "output.mp4",
    ]);

    let mut child = command
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdin = child.stdin.take().ok_or("Failed to open stdin")?;
    *FFMPEG_STDIN.lock().unwrap() = Some(stdin);

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

pub fn receive_frame(frame: Vec<u8>) -> Result<(), String> {
    if let Some(stdin) = &mut *FFMPEG_STDIN.lock().unwrap() {
        stdin.write_all(&frame).map_err(|e| e.to_string())?;
    } else {
        return Err("FFmpeg stdin is not available".into());
    }
    Ok(())
}

pub fn finish_video() -> Result<(), String> {
    let mut guard = FFMPEG_STDIN.lock().unwrap();
    if let Some(stdin) = guard.take() {
        drop(stdin); // This closes the stdin pipe
    }
    Ok(())
}