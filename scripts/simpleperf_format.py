"""Encode characters reserved by folded stacks without merging symbol names."""

def encode_frame(value):
    value = str(value or '').strip() or 'unknown'
    return (value.replace('%', '%25').replace(';', '%3B')
            .replace('\r', '%0D').replace('\n', '%0A'))
