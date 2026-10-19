package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDoubaoVideoProtocolConvertPreservesOfficialMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v3/contents/generations/tasks",
		DoubaoVideoProtocolConvert(),
		DoubaoVideoCreateResponseConvert(),
		func(c *gin.Context) {
			assert.Equal(t, "/v1/video/generations", c.Request.URL.Path)
			var body struct {
				Model    string         `json:"model"`
				Prompt   string         `json:"prompt"`
				Images   []string       `json:"images"`
				Duration int            `json:"duration"`
				Draft    *bool          `json:"draft"`
				Metadata map[string]any `json:"metadata"`
			}
			require.NoError(t, common.UnmarshalBodyReusable(c, &body))
			assert.Equal(t, "doubao-seedance-2-0-260128", body.Model)
			assert.Equal(t, "first line\nsecond line", body.Prompt)
			assert.Equal(t, []string{"https://example.com/input.png"}, body.Images)
			assert.Equal(t, 6, body.Duration)
			require.NotNil(t, body.Draft)
			assert.True(t, *body.Draft)
			assert.Equal(t, "1080p", body.Metadata["resolution"])
			content, ok := body.Metadata["content"].([]any)
			require.True(t, ok)
			assert.Len(t, content, 5)
			assert.Equal(t, map[string]any{"type": "draft_task", "draft_task": map[string]any{"id": "xxxxx"}}, content[4])

			common.SetContextKey(c, constant.ContextKeyPublicTaskID, "task_public")
			c.JSON(http.StatusOK, gin.H{"id": "upstream_secret"})
		})

	body := `{
		"model":"doubao-seedance-2-0-260128",
		"content":[
			{"type":"text","text":"first line"},
			{"type":"image_url","image_url":{"url":"https://example.com/input.png"}},
			{"type":"video_url","video_url":{"url":"https://example.com/input.mp4"}},
			{"type":"text","text":"second line"},
			{"type":"draft_task","draft_task":{"id":"xxxxx"}}
		],
		"duration":6,
		"resolution":"1080p",
		"draft":true
	}`
	request := httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response map[string]string
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.Equal(t, map[string]string{"id": "task_public"}, response)
}

func TestDoubaoVideoCreateResponseConvertPreservesErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v3/contents/generations/tasks",
		DoubaoVideoCreateResponseConvert(),
		func(c *gin.Context) {
			c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"message": "invalid"}})
		})

	request := httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.JSONEq(t, `{"error":{"message":"invalid"}}`, recorder.Body.String())
}

func TestDoubaoVideoProtocolConvertAllowsDraftTaskWithoutTextForSeedance25(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v3/contents/generations/tasks", DoubaoVideoProtocolConvert(), func(c *gin.Context) {
		assert.True(t, c.GetBool("doubao_draft_task_without_text"))
		var body struct {
			Prompt   string         `json:"prompt"`
			Metadata map[string]any `json:"metadata"`
		}
		require.NoError(t, common.UnmarshalBodyReusable(c, &body))
		assert.Empty(t, body.Prompt)
		content, ok := body.Metadata["content"].([]any)
		require.True(t, ok)
		assert.Equal(t, map[string]any{"type": "draft_task", "draft_task": map[string]any{"id": "cgt-20261019125019-8lwc9"}}, content[0])
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", strings.NewReader(`{
		"model":"doubao-seedance-2-5-260628",
		"content":[{"type":"draft_task","draft_task":{"id":"cgt-20261019125019-8lwc9"}}],
		"resolution":"1080p"
	}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusNoContent, recorder.Code)
}

func TestDoubaoVideoProtocolConvertStillRequiresTextWithoutDraftTask(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/api/v3/contents/generations/tasks", DoubaoVideoProtocolConvert(), func(c *gin.Context) {
		t.Fatal("request without text or a draft task should not reach the next handler")
	})

	request := httptest.NewRequest(http.MethodPost, "/api/v3/contents/generations/tasks", strings.NewReader(`{
		"model":"doubao-seedance-2-5-260628",
		"content":[],
		"resolution":"1080p"
	}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusBadRequest, recorder.Code)
	assert.Contains(t, recorder.Body.String(), "text content is required")
}

func TestDoubaoVideoProtocolConvertRewritesFetchPath(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v3/contents/generations/tasks/:task_id",
		DoubaoVideoProtocolConvert(),
		func(c *gin.Context) {
			assert.Equal(t, "/v1/video/generations/task_public", c.Request.URL.Path)
			assert.Equal(t, "task_public", c.Param("task_id"))
			c.Status(http.StatusNoContent)
		})

	request := httptest.NewRequest(http.MethodGet, "/api/v3/contents/generations/tasks/task_public", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusNoContent, recorder.Code)
}
