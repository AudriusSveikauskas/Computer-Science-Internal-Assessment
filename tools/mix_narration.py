#!/usr/bin/env python3
"""Adds the spoken commentary to the recorded video.

    python3 tools/mix_narration.py <recording-folder> <narration-folder> <output.mp4>

Reads <recording-folder>/timeline.json (written by tools/record_video.js),
finds in the video the grey corner marker that starts each clip (shade
10 + 10 x clip number), speeds the video back up to real time, places
every <narration-folder>/<id>.wav where its marker is,
and encodes an MP4 (H.264 video, AAC audio) with ffmpeg.
"""

import json
import os
import subprocess
import sys


FPS = 25


def marker_starts(video, count, clock=None):
    """Seconds at which each clip's marker first appears in the video.
    A marker that cannot be found is placed between its neighbours in
    proportion to the clock times recorded in timeline.json."""
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
            starts.append(None)
            frame = int(starts[-2] * FPS) if len(starts) > 1 and starts[-2] is not None else 0
            continue
        starts.append(frame / FPS)
    for k, s in enumerate(starts):
        if s is None:
            if clock is None:
                raise SystemExit("marker for clip %d not found" % (k + 1))
            before = max([j for j in range(k) if starts[j] is not None], default=None)
            after = min([j for j in range(k + 1, len(starts)) if starts[j] is not None], default=None)
            if before is None or after is None:
                raise SystemExit("marker for clip %d not found" % (k + 1))
            share = (clock[k] - clock[before]) / (clock[after] - clock[before])
            starts[k] = starts[before] + share * (starts[after] - starts[before])
            print("clip %d: marker not found, placed by the clock at %.1f s" % (k + 1, starts[k]))
    return starts


def main():
    rec, narr, out = sys.argv[1], sys.argv[2], sys.argv[3]
    timeline = json.load(open(os.path.join(rec, "timeline.json")))
    clips = timeline["clips"]
    clock = [c["start"] for c in clips]
    marks = marker_starts(timeline["video"], len(clips), clock)

    # The recording runs slower than real time, by a nearly constant factor.
    # The factor that best maps marker times onto clock times (least squares
    # through 0) speeds the whole video up; each clip then starts at its
    # marker time multiplied by the same factor.
    factor = sum(c * m for c, m in zip(clock, marks)) / sum(m * m for m in marks)
    worst = max(abs(m * factor - c) for c, m in zip(clock, marks))
    print("speed-up factor %.4f; largest difference from the clock %.2f s" % (factor, worst))
    for c, m in zip(clips, marks):
        c["start"] = m * factor
    parts = ["[0:v]setpts=PTS*%.5f,fps=25[vout]" % factor]
    duration = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                     "-of", "csv=p=0", timeline["video"]],
                                    check=True, capture_output=True, text=True).stdout) * factor

    cmd = ["ffmpeg", "-v", "error", "-y", "-i", timeline["video"]]
    for c in clips:
        cmd += ["-i", os.path.join(narr, c["id"] + ".wav")]
    for i, c in enumerate(clips, start=1):
        ms = int(round(c["start"] * 1000))
        parts.append("[%d:a]adelay=%d|%d[a%d]" % (i, ms, ms, i))
    mix = "".join("[a%d]" % i for i in range(1, len(clips) + 1))
    parts.append(mix + "amix=inputs=%d:normalize=0:duration=longest,apad=whole_dur=%.3f[aout]" % (len(clips), duration))
    cmd += ["-filter_complex", ";".join(parts), "-map", "[vout]", "-map", "[aout]", "-t", "%.3f" % duration,
            "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out]
    subprocess.run(cmd, check=True)
    print("Written", out)


if __name__ == "__main__":
    main()
