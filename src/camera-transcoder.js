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
    '-loglevel', 'warning',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-analyzeduration', '100000',
    '-probesize', '500000',
    '-use_wallclock_as_timestamps', '1',
    '-f', 'mjpeg',
    '-i', sourceUrl,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-g', '30',
    '-keyint_min', '30',
    '-sc_threshold', '0',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
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
