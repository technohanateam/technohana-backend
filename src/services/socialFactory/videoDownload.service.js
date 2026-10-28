import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

export const OUTPUT_DIR = path.resolve("output", "news-videos");
const FONT = process.env.VIDEO_FONT_FILE || "C:/Windows/Fonts/arialbd.ttf";

export const localVideoToolsEnabled = () => process.env.LOCAL_VIDEO_TOOLS === "true";

// ffmpeg filter paths need forward slashes and an escaped drive colon.
const ffPath = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

function wrap(text, width) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) {
      lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.slice(0, 3).join("\n");
}

// Crops to 9:16 and burns Technohana branding, a credit line and a hook onto a local clip.
export async function brandVideo(raw, item, work) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, `${String(item._id)}.mp4`);

  const texts = {
    brand: "TECHNOHANA",
    hook: wrap(item.angle || item.title, 28),
    credit: wrap(`Original: ${item.source} - ${item.title}`, 42),
    mark: "technohana.in",
  };
  const files = {};
  for (const [k, v] of Object.entries(texts)) {
    files[k] = path.join(work, `${k}.txt`);
    await fs.writeFile(files[k], v, "utf8");
  }

  const dt = (k, extra) => `drawtext=fontfile='${ffPath(FONT)}':textfile='${ffPath(files[k])}':fontcolor=white:${extra}`;
  const filter = [
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    "drawbox=x=0:y=0:w=iw:h=170:color=0x4C1D95@0.92:t=fill",
    "drawbox=x=0:y=170:w=iw:h=8:color=0xFFC107:t=fill",
    dt("brand", "fontsize=64:x=(w-text_w)/2:y=52"),
    "drawbox=x=0:y=ih-460:w=iw:h=460:color=0x000000@0.6:t=fill",
    dt("hook", "fontsize=58:line_spacing=12:x=60:y=h-430"),
    dt("credit", "fontsize=34:fontcolor=0xFFC107:line_spacing=8:x=60:y=h-150"),
    dt("mark", "fontsize=36:fontcolor=white@0.55:x=w-text_w-50:y=230"),
  ].join(",");

  await run(
    "ffmpeg",
    ["-y", "-i", raw, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", out],
    { timeout: 10 * 60 * 1000 }
  );
  return out;
}

// Downloads a clip (max 60s / 50MB / 1080p), then brands it. Returns the rendered file path.
export async function makeBrandedVideo(item) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "news-video-"));
  const raw = path.join(work, "raw.mp4");
  try {
    await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--max-filesize", "50M",
        "--download-sections", "*0-60",
        "-f", "bv*[height<=1080]+ba/b[height<=1080]",
        "--merge-output-format", "mp4",
        "-o", raw,
        item.url,
      ],
      { timeout: 5 * 60 * 1000 }
    );
    return await brandVideo(raw, item, work);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
