package service

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/credentials"
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
	target := strings.TrimRight(config.Endpoint, "/") + "/" + url.PathEscape(config.Bucket) + "/" + strings.TrimLeft(key, "/")
	request, err := http.NewRequest(http.MethodPut, target, nil)
	if err != nil { return "", err }
	request.Header.Set("Content-Type", contentType)
	query := request.URL.Query()
	query.Set("X-Amz-Expires", "900")
	request.URL.RawQuery = query.Encode()
	provider := credentials.NewStaticCredentialsProvider(config.AccessKeyID, config.AccessKeySecret, "")
	value, err := provider.Retrieve(context.Background())
	if err != nil { return "", err }
	signedURL, _, err := v4.NewSigner().PresignHTTP(context.Background(), value, request, "UNSIGNED-PAYLOAD", "s3", config.Region, time.Now())
	return signedURL, err
}
