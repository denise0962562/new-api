package controller

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func usageExportAllowed(c *gin.Context) bool {
	u, err := model.GetUserById(c.GetInt("id"), false)
	return err == nil && u.UsageExportEnabled
}

func CreateUsageExport(c *gin.Context) {
	if !usageExportAllowed(c) { c.JSON(http.StatusForbidden, gin.H{"success":false,"message":"usage export is not enabled"}); return }
	service.CleanupUsageExportFiles()
	start, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	end, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	if start <= 0 || end <= 0 || end < start || end-start > 31*24*60*60 { common.ApiErrorMsg(c, "time range must not exceed 31 days"); return }
	models := []string{}; for _, v := range strings.Split(c.Query("models"), ",") { if strings.TrimSpace(v) != "" { models = append(models, strings.TrimSpace(v)) } }
	uid := c.GetInt("id")
	now := time.Now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).Unix()
	var count int64
	userPayloadPattern := fmt.Sprintf(`%%"user_id":%d%%`, uid)
	_ = model.DB.Model(&model.SystemTask{}).Where("type = ? AND created_at >= ? AND payload LIKE ?", model.SystemTaskTypeUsageExport, dayStart, userPayloadPattern).Count(&count).Error
	if count >= 5 { common.ApiErrorMsg(c, "daily usage export limit reached"); return }
	task, err := model.CreateSystemTask(model.SystemTaskTypeUsageExport, service.UsageExportPayload{UserID:uid,Start:start,End:end,Models:models}, map[string]any{"progress":0})
	if err != nil { common.ApiError(c, err); return }
	service.NotifyUsageExportRunner()
	common.ApiSuccess(c, gin.H{"task_id":task.TaskID})
}

func GetUsageExport(c *gin.Context) {
	if !usageExportAllowed(c) { c.JSON(http.StatusForbidden, gin.H{"success":false,"message":"usage export is not enabled"}); return }
	task, err := model.GetSystemTaskByTaskID(c.Param("task_id")); if err != nil || task == nil { c.Status(http.StatusNotFound); return }
	var p service.UsageExportPayload; _ = task.DecodePayload(&p)
	if p.UserID != c.GetInt("id") { c.Status(http.StatusForbidden); return }
	if c.Query("status") == "1" { common.ApiSuccess(c, task.ToResponse()); return }
	if task.Status != model.SystemTaskStatusSucceeded { common.ApiSuccess(c, task.ToResponse()); return }
	var result service.UsageExportResult; _ = task.DecodeResult(&result)
	if result.File == "" { c.Status(http.StatusNotFound); return }
	c.FileAttachment(result.File, filepath.Base(result.File))
	// FileAttachment writes the response synchronously. Remove the generated
	// file immediately after the download has been handed to the client.
	_ = os.Remove(result.File)
}

func ListUsageExports(c *gin.Context) {
	if !usageExportAllowed(c) { c.JSON(http.StatusForbidden, gin.H{"success":false}); return }
	service.CleanupUsageExportFiles()
	var tasks []*model.SystemTask
	model.DB.Where("type = ?", model.SystemTaskTypeUsageExport).Order("id desc").Limit(20).Find(&tasks)
	uid := c.GetInt("id"); out := make([]model.SystemTaskResponse,0,len(tasks))
	for _, t := range tasks { var p service.UsageExportPayload; _ = t.DecodePayload(&p); if p.UserID == uid { out = append(out,t.ToResponse()) } }
	common.ApiSuccess(c, out)
}
