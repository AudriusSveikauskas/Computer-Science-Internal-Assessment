#!/usr/bin/env python3
"""Prepares the candidate's own voice recordings for the video.

    python3 tools/prepare_recordings.py <recordings-folder> <output-folder>

The recordings folder holds one file per paragraph of the commentary,
named by its number: 01.m4a, 02.mp3, 03.wav, ... (any format ffmpeg
reads). Each file is converted to mono WAV, silence at its start and
end is trimmed, and it is saved as <id>.wav with the ids of
tools/narration.json. durations.json is written next to them, so that

    node tools/record_video.js <video-folder> <output-folder>
    python3 tools/mix_narration.py <video-folder> <output-folder> video.mp4

record a video whose parts last exactly as long as the recordings.
"""

import json
import os
import subprocess
import sys
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Trim silence quieter than -45 dB at both ends, keep 0.15 s around the speech
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,"
        "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,"
        "loudnorm=I=-18:TP=-1.5")


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    segments = json.load(open(os.path.join(ROOT, "tools", "narration.json"), encoding="utf-8"))
    files = {os.path.splitext(f)[0]: f for f in os.listdir(src)}
    durations = {}
    for number, seg in enumerate(segments, start=1):
        name = files.get("%02d" % number)
        if name is None:
            sys.exit("Missing recording %02d (%s)" % (number, seg["id"]))
        target = os.path.join(out, seg["id"] + ".wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(src, name),
                        "-af", TRIM, "-ac", "1", "-ar", "44100", target], check=True)
        with wave.open(target) as w:
            durations[seg["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print("%02d %-11s %5.1f s" % (number, seg["id"], durations[seg["id"]]))
    json.dump(durations, open(os.path.join(out, "durations.json"), "w"), indent=2)
    total = sum(durations.values())
    print("total speech %.1f s" % total)


if __name__ == "__main__":
    main()
