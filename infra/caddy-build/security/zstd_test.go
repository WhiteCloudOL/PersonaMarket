package security_test

import (
	"bytes"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// Upstream GHSA-fpmh-frq8-7rj8 frame exceeds the Huffman weights table bound.
// v1.20.2 rejects it before reusing corrupt FSE state; acceptance is not required.
func TestZstdRejectsOversizedWeightsWithoutPanic(t *testing.T) {
	frame := slices.Concat(
		[]byte{0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x38, 0x74, 0x06, 0x00, 0x42, 0xb8, 0x32, 0x0d, 0x1a, 0x00, 0x00, 0x00, 0x90, 0xaf, 0xfa, 0xff, 0x03, 0x00, 0x80, 0xff, 0x7f},
		bytes.Repeat([]byte{0xa5, 0x94, 0x52, 0x4a, 0x29}, 37),
		[]byte{0xa5, 0x94, 0x12, 0x00, 0xad, 0x56, 0x03, 0xee, 0xff, 0xdf, 0xb3, 0x1a, 0x1c, 0x1a, 0x00, 0xe0, 0xff, 0x1f, 0x0f, 0xb1, 0x9c, 0x5a, 0xcf, 0x4d, 0xe4, 0x1d, 0x7b, 0xab, 0x99, 0x5e, 0x01, 0x51, 0xa4, 0x73, 0xd8, 0xb1, 0xf3, 0x39, 0x4b, 0x67, 0xf6, 0xab, 0x1a, 0xab, 0x1a, 0xab, 0x1a},
		bytes.Repeat([]byte{0x8c, 0x31, 0xc6, 0x18, 0x63}, 1365), []byte{0x8c, 0x31},
		bytes.Repeat([]byte{0x63, 0x8c, 0x31, 0xc6, 0x18}, 1365), []byte{0x63, 0x2c},
		bytes.Repeat([]byte{0x31, 0xc6, 0x18, 0x63, 0x8c}, 1365), []byte{0x31, 0x46},
		bytes.Repeat([]byte{0x31, 0xc6, 0x18, 0x63, 0x8c}, 1365), []byte{0x31, 0x06, 0x00},
	)
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer decoder.Close()
	if _, err := decoder.DecodeAll(frame, nil); err == nil || !strings.Contains(err.Error(), "weights tableLog too big") {
		t.Fatalf("oversized weights must return the bounded decode error, got %v", err)
	}
	stream, err := zstd.NewReader(bytes.NewReader(frame))
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	if _, err := io.Copy(io.Discard, stream); err == nil || !strings.Contains(err.Error(), "weights tableLog too big") {
		t.Fatalf("streaming oversized weights must return the bounded decode error, got %v", err)
	}
}

func TestZstdOrdinaryRoundtrip(t *testing.T) {
	encoder, err := zstd.NewWriter(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer encoder.Close()
	decoder, err := zstd.NewReader(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer decoder.Close()
	want := bytes.Repeat([]byte("PersonaMarket compression regression\n"), 1024)
	got, err := decoder.DecodeAll(encoder.EncodeAll(want, nil), nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("ordinary zstd payload changed")
	}
}
