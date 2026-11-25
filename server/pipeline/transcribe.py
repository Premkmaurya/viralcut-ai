#!/usr/bin/env python3
"""
transcribe.py - Speech-to-text transcription using faster-whisper.
Outputs structured JSON containing timestamped segments and words.
"""

import sys
import os
import json
import argparse
import time

def parse_args():
    parser = argparse.ArgumentParser(description="Transcribe audio using faster-whisper")
    parser.add_argument("--audio", required=True, help="Path to input 16 kHz mono WAV file")
    parser.add_argument("--output", required=True, help="Path to output JSON file")
    parser.add_argument("--model", default="base", help="Model size: tiny, base, small, medium, large-v3")
    parser.add_argument("--device", default="cpu", help="Device: cpu or cuda")
    parser.add_argument("--compute_type", default="int8", help="Compute type: int8, float16, float32")
    return parser.parse_args()

def transcribe_with_faster_whisper(audio_path, model_name, device, compute_type):
    from faster_whisper import WhisperModel

    # For CPU, default compute_type is int8 for efficiency
    if device == "cpu" and compute_type == "float16":
        compute_type = "int8"

    print(f"Loading faster-whisper model '{model_name}' on {device} ({compute_type})...", file=sys.stderr)
    model = WhisperModel(model_name, device=device, compute_type=compute_type)

    print(f"Transcribing audio: {audio_path}...", file=sys.stderr)
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500)
    )

    segment_list = []
    full_text_parts = []

    for seg in segments:
        words_data = []
        if hasattr(seg, 'words') and seg.words:
            for w in seg.words:
                words_data.append({
                    "word": w.word.strip(),
                    "start": round(w.start, 2),
                    "end": round(w.end, 2),
                    "probability": round(w.probability, 3)
                })

        text = seg.text.strip()
        full_text_parts.append(text)
        segment_list.append({
            "id": seg.id,
            "start": round(seg.start, 2),
            "end": round(seg.end, 2),
            "text": text,
            "words": words_data
        })

    return {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(info.duration, 2),
        "full_text": " ".join(full_text_parts),
        "segments": segment_list
    }

def main():
    args = parse_args()

    if not os.path.exists(args.audio):
        print(f"Error: Audio file not found at {args.audio}", file=sys.stderr)
        sys.exit(1)

    start_time = time.time()

    try:
        data = transcribe_with_faster_whisper(args.audio, args.model, args.device, args.compute_type)
        data["execution_time_seconds"] = round(time.time() - start_time, 2)

        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"Transcription successful: {len(data['segments'])} segments written to {args.output}")
        sys.exit(0)

    except ImportError as e:
        print(f"faster-whisper is not installed: {e}", file=sys.stderr)
        # Output structured error or fallback flag
        sys.exit(2)
    except Exception as e:
        print(f"Transcription error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
