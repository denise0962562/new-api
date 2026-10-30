package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

type QuotaApplicationR2Config struct {
	Enabled       bool   `json:"enabled"`
	Endpoint      string `json:"endpoint"`
	Region        string `json:"region"`
	Bucket        string `json:"bucket"`
	PublicBaseURL string `json:"public_base_url"`
	AccessKeyID   string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
}

func QuotaApplicationR2ConfigFromOptions() QuotaApplicationR2Config {
	common.OptionMapRWMutex.RLock(); defer common.OptionMapRWMutex.RUnlock()
	return QuotaApplicationR2Config{Enabled: common.OptionMap["quota_application.r2.enabled"] == "true", Endpoint: common.OptionMap["quota_application.r2.endpoint"], Region: common.OptionMap["quota_application.r2.region"], Bucket: common.OptionMap["quota_application.r2.bucket"], PublicBaseURL: common.OptionMap["quota_application.r2.public_base_url"], AccessKeyID: common.OptionMap["quota_application.r2.access_key_id"], AccessKeySecret: common.OptionMap["quota_application.r2.access_key_secret"]}
}

func R2ObjectURL(config QuotaApplicationR2Config, key string) string {
	return strings.TrimRight(config.PublicBaseURL, "/") + "/" + strings.TrimLeft(key, "/")
}

func PresignQuotaApplicationUpload(config QuotaApplicationR2Config, key, contentType string) (string, error) {
	if !config.Enabled || config.Endpoint == "" || config.Region == "" || config.Bucket == "" || config.AccessKeyID == "" || config.AccessKeySecret == "" { return "", fmt.Errorf("R2 storage is not configured") }
	t := time.Now().UTC(); amzDate := t.Format("20060102T150405Z"); date := t.Format("20060102"); host := strings.TrimPrefix(strings.TrimPrefix(config.Endpoint, "https://"), "http://"); host = strings.TrimRight(host, "/")
	path := "/" + url.PathEscape(config.Bucket) + "/" + strings.ReplaceAll(key, " ", "%20")
	credential := config.AccessKeyID + "/" + date + "/" + config.Region + "/s3/aws4_request"
	query := "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=" + url.QueryEscape(credential) + "&X-Amz-Date=" + amzDate + "&X-Amz-Expires=900&X-Amz-SignedHeaders=content-type%3Bhost"
	canonical := "PUT\n" + path + "\n" + query + "\ncontent-type:" + contentType + "\nhost:" + host + "\n\ncontent-type;host\nUNSIGNED-PAYLOAD"
	hash := sha256.Sum256([]byte(canonical)); scope := date + "/" + config.Region + "/s3/aws4_request"; stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(hash[:])
	kDate := hmacSha256([]byte("AWS4"+config.AccessKeySecret), date); kRegion := hmacSha256(kDate, config.Region); kService := hmacSha256(kRegion, "s3"); kSigning := hmacSha256(kService, "aws4_request"); sig := hmacSha256(kSigning, stringToSign)
	return "https://" + host + path + "?" + query + "&X-Amz-Signature=" + hex.EncodeToString(sig), nil
}

func hmacSha256(key []byte, value string) []byte { h := hmac.New(sha256.New, key); h.Write([]byte(value)); return h.Sum(nil) }
