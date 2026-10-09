#!/usr/bin/env python3
"""Adds the spoken commentary to the recorded video.

    python3 tools/mix_narration.py <recording-folder> <narration-folder> <output.mp4>

Reads <recording-folder>/timeline.json (written by tools/record_video.js),
finds in the video the grey corner marker that starts each clip (shade
10 + 10 x clip number), places every <narration-folder>/<id>.wav there,
and encodes an MP4 (H.264 video, AAC audio) with ffmpeg.
"""

import json
import os
import subprocess
import sys


FPS = 25


def marker_starts(video, count):
    """Seconds at which each clip's marker first appears in the video."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf",
                          "fps=%d,crop=6:6:2:2,scale=1:1" % FPS, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         check=True, capture_output=True).stdout
    shades = list(raw)
    starts, frame = [], 0
    for k in range(1, count + 1):
        target = 10 + 10 * k
        while frame + 2 < len(shades) and not all(abs(shades[frame + j] - target) <= 4 for j in range(3)):
            frame += 1
        if frame + 2 >= len(shades):
            raise SystemExit("marker for clip %d not found" % k)
        starts.append(frame / FPS)
    return starts


def main():
    rec, narr, out = sys.argv[1], sys.argv[2], sys.argv[3]
    timeline = json.load(open(os.path.join(rec, "timeline.json")))
    clips = timeline["clips"]
    for c, start in zip(clips, marker_starts(timeline["video"], len(clips))):
        print("%-11s clock %6.1f s   video %6.1f s" % (c["id"], c["start"], start))
        c["start"] = start
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", timeline["video"]]
    for c in clips:
        cmd += ["-i", os.path.join(narr, c["id"] + ".wav")]
    parts = []
    for i, c in enumerate(clips, start=1):
        ms = int(round(c["start"] * 1000))
        parts.append("[%d:a]adelay=%d|%d[a%d]" % (i, ms, ms, i))
    mix = "".join("[a%d]" % i for i in range(1, len(clips) + 1))
    graph = ";".join(parts) + ";" + mix + "amix=inputs=%d:normalize=0,apad[aout]" % len(clips)
    cmd += ["-filter_complex", graph, "-map", "0:v", "-map", "[aout]", "-shortest",
            "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-r", "25",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    print("Written", out)


if __name__ == "__main__":
    main()
