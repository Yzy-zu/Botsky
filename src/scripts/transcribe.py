import sys
import os
import warnings

warnings.filterwarnings("ignore")
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"

try:
    from faster_whisper import WhisperModel
except ImportError:
    print("ModuleNotFoundError: faster-whisper", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) < 4:
        print("Usage: transcribe.py <audio_file> <model> <language>", file=sys.stderr)
        sys.exit(1)
        
    audio_file = sys.argv[1]
    model_size = sys.argv[2]
    language = sys.argv[3]
    
    if language.lower() == 'auto':
        language = None
        
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
    
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(audio_file, beam_size=5, language=language)
        
        print(f"Idioma detectado: {info.language} (prob: {info.language_probability:.2f})", file=sys.stderr)
        
        text = "".join(segment.text for segment in segments)
        if not text.strip():
            sys.exit(3)
            
        print(text)
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
