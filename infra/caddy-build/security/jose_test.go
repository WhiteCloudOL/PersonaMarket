package security_test

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	jose3 "github.com/go-jose/go-jose/v3"
	jose4 "github.com/go-jose/go-jose/v4"
)

func encodedInteger(bits int) string {
	n := new(big.Int).Lsh(big.NewInt(1), uint(bits-1))
	n.SetBit(n, 0, 1)
	return base64.RawURLEncoding.EncodeToString(n.Bytes())
}

func TestJWKRejectsUnboundedRSA(t *testing.T) {
	parsers := map[string]func([]byte) error{
		"v3": func(raw []byte) error { var key jose3.JSONWebKey; return json.Unmarshal(raw, &key) },
		"v4": func(raw []byte) error { var key jose4.JSONWebKey; return json.Unmarshal(raw, &key) },
	}
	for version, parse := range parsers {
		for _, private := range []bool{false, true} {
			t.Run(version+map[bool]string{false: "-public", true: "-private"}[private], func(t *testing.T) {
				key := map[string]string{"kty": "RSA", "n": encodedInteger(8192), "e": "AQAB"}
				if private {
					key["d"], key["p"], key["q"] = "Aw", "Aw", "Aw"
				}
				raw, err := json.Marshal(key)
				if err != nil {
					t.Fatal(err)
				}
				if err := parse(raw); err == nil || !strings.Contains(err.Error(), "modulus too large") {
					t.Fatalf("oversized RSA modulus must be rejected before RSA validation, got %v", err)
				}
			})
		}
		t.Run(version+"-degenerate-primes", func(t *testing.T) {
			raw, err := json.Marshal(map[string]string{"kty": "RSA", "n": encodedInteger(2048), "e": "AQAB", "d": "Aw", "p": encodedInteger(16384), "q": "Aw"})
			if err != nil {
				t.Fatal(err)
			}
			if err := parse(raw); err == nil || !strings.Contains(err.Error(), "p * q != n") {
				t.Fatalf("inconsistent RSA primes must be rejected before RSA validation, got %v", err)
			}
		})
	}
}

func TestJWSRejectsEmbeddedPrivateMaterial(t *testing.T) {
	parsers := map[string]func(string) error{
		"v3": func(raw string) error { _, err := jose3.ParseSigned(raw); return err },
		"v4": func(raw string) error {
			_, err := jose4.ParseSigned(raw, []jose4.SignatureAlgorithm{jose4.RS256})
			return err
		},
	}
	for version, parse := range parsers {
		for _, protected := range []bool{true, false} {
			t.Run(version+map[bool]string{true: "-protected", false: "-unprotected"}[protected], func(t *testing.T) {
				header := map[string]any{"alg": "RS256", "jwk": map[string]string{"kty": "RSA", "n": encodedInteger(2048), "e": "AQAB", "d": "Aw", "p": encodedInteger(16384), "q": "Aw"}}
				message := map[string]any{"payload": "e30", "signature": "AA"}
				if protected {
					raw, err := json.Marshal(header)
					if err != nil {
						t.Fatal(err)
					}
					message["protected"] = base64.RawURLEncoding.EncodeToString(raw)
				} else {
					message["header"] = header
				}
				signature := map[string]any{}
				for name, value := range message {
					if name != "payload" {
						signature[name] = value
					}
				}
				for name, document := range map[string]any{
					"flattened": message,
					"general":   map[string]any{"payload": "e30", "signatures": []any{signature}},
				} {
					t.Run(name, func(t *testing.T) {
						raw, err := json.Marshal(document)
						if err != nil {
							t.Fatal(err)
						}
						if err := parse(string(raw)); err == nil || !strings.Contains(err.Error(), "private parameters") {
							t.Fatalf("private header parameters must be rejected before key parsing, got %v", err)
						}
					})
				}
			})
		}
	}
}

func TestOrdinaryRSAKeysRemainUsable(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(jose3.JSONWebKey{Key: key})
	if err != nil {
		t.Fatal(err)
	}
	var key3 jose3.JSONWebKey
	var key4 jose4.JSONWebKey
	if err := json.Unmarshal(raw, &key3); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &key4); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]any{"v3": key3.Key, "v4": key4.Key} {
		parsed, ok := value.(*rsa.PrivateKey)
		if !ok || parsed.N.Cmp(key.N) != 0 || parsed.D.Cmp(key.D) != 0 {
			t.Fatalf("%s changed ordinary RSA key", name)
		}
	}
}
