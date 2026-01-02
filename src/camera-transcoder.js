const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

/**
 * Spawn an ffmpeg process that converts an MJPEG stream to H.264 (MP4 container).
 * Returns the spawned process whose stdout is the fragmented MP4 stream.
 */
function startH264Transcode(sourceUrl, onStderr) {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not found');
  }

  const args = [
    '-loglevel', 'error',
    '-err_detect', 'ignore_err',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-fflags', '+genpts+igndts',
    '-flags', 'low_delay',
    '-analyzeduration', '1000000',
    '-probesize', '1000000',
    '-f', 'mjpeg',
    '-i', sourceUrl,
    '-vf', 'fps=15',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-level', '3.0',
    '-pix_fmt', 'yuv420p',
    '-b:v', '800k',
    '-g', '30',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof+faststart',
    '-f', 'mp4',
    '-reset_timestamps', '1',
    'pipe:1'
  ];

  const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (onStderr) {
    proc.stderr.on('data', (chunk) => onStderr(chunk.toString()));
  }
  return proc;
}

module.exports = {
  startH264Transcode
};
