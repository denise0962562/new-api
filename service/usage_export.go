package service

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const UsageExportMaxRows = 100000
const UsageExportFileRetention = 24 * time.Hour

// CleanupUsageExportFiles removes abandoned export files. It is intentionally
// filesystem-scoped and only touches the dedicated usage-export directory.
func CleanupUsageExportFiles() {
	dir := filepath.Join("data", "usage-exports")
	entries, err := os.ReadDir(dir)
	if err != nil { return }
	cutoff := time.Now().Add(-UsageExportFileRetention)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".csv" { continue }
		path := filepath.Join(dir, entry.Name())
		info, err := entry.Info(); if err != nil { continue }
		if info.ModTime().Before(cutoff) { _ = os.Remove(path) }
	}
}

type UsageExportPayload struct {
	UserID int `json:"user_id"`
	Start int64 `json:"start"`
	End int64 `json:"end"`
	Models []string `json:"models"`
}

type UsageExportResult struct {
	File string `json:"file"`
	Rows int `json:"rows"`
}

type usageExportHandler struct{}
func (usageExportHandler) Type() string { return model.SystemTaskTypeUsageExport }

func init() { RegisterSystemTaskHandler(usageExportHandler{}) }

func (usageExportHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var p UsageExportPayload
	if err := task.DecodePayload(&p); err != nil { failSystemTask(task, runnerID, err); return }
	result, err := buildUsageExport(ctx, p)
	if err != nil { failSystemTask(task, runnerID, err); return }
	if err := model.FinishSystemTask(task.TaskID, runnerID, model.SystemTaskStatusSucceeded, result, ""); err != nil { return }
}

type usageExportRow struct { User, Model, Request string; Created, Quota, Prompt, Completion int64; Async bool }

func buildUsageExport(ctx context.Context, p UsageExportPayload) (UsageExportResult, error) {
	if err := ctx.Err(); err != nil { return UsageExportResult{}, err }
	CleanupUsageExportFiles()
	groups := map[string]*usageExportRow{}
	taskQuery := model.DB.Where("status = ? AND submit_time >= ? AND submit_time <= ?", model.TaskStatusSuccess, p.Start, p.End)
	if p.UserID > 0 { taskQuery = taskQuery.Where("user_id = ?", p.UserID) }
	if len(p.Models) > 0 { taskQuery = taskQuery.Where("model_name IN ?", p.Models) }
	var tasks []*model.Task
	if err := taskQuery.Order("submit_time asc, id asc").Limit(UsageExportMaxRows + 1).Find(&tasks).Error; err != nil { return UsageExportResult{}, err }
	if len(tasks) > UsageExportMaxRows { return UsageExportResult{}, fmt.Errorf("too many records") }
	for _, task := range tasks {
		username, _ := model.GetUsernameById(task.UserId, false)
		groups["task:"+task.TaskID] = &usageExportRow{User: username, Model: task.ModelName, Request: task.TaskID, Created: task.SubmitTime, Quota: int64(task.Quota), Async: true}
	}
	var logs []*model.Log
	tx := model.LOG_DB.Where("type = ? AND created_at >= ? AND created_at <= ?", model.LogTypeConsume, p.Start, p.End)
	if p.UserID > 0 { tx = tx.Where("user_id = ?", p.UserID) }
	if len(p.Models) > 0 { tx = tx.Where("model_name IN ?", p.Models) }
	if err := tx.Order("created_at asc, id asc").Limit(UsageExportMaxRows + 1).Find(&logs).Error; err != nil { return UsageExportResult{}, err }
	if len(logs) > UsageExportMaxRows { return UsageExportResult{}, fmt.Errorf("too many records") }
	for _, l := range logs {
		if err := ctx.Err(); err != nil { return UsageExportResult{}, err }
		var other map[string]any; _ = json.Unmarshal([]byte(l.Other), &other)
		key := l.RequestId
		if key == "" { key = fmt.Sprintf("log:%d", l.Id) }
		if v, ok := other["task_id"].(string); ok && v != "" { continue }
		if groups[key] == nil { groups[key] = &usageExportRow{User:l.Username, Model:l.ModelName, Request:l.RequestId, Created:l.CreatedAt, Async: strings.HasPrefix(key, "task:")} }
		g := groups[key]
		g.Quota += int64(l.Quota)
		g.Prompt += int64(l.PromptTokens); g.Completion += int64(l.CompletionTokens)
	}
	if len(groups) > UsageExportMaxRows { return UsageExportResult{}, fmt.Errorf("too many records") }
	dir := filepath.Join("data", "usage-exports"); if err := os.MkdirAll(dir, 0750); err != nil { return UsageExportResult{}, err }
	name := fmt.Sprintf("usage-%d-%s.csv", p.UserID, common.GetRandomString(16)); path := filepath.Join(dir, name)
	f, err := os.Create(path); if err != nil { return UsageExportResult{}, err }; defer f.Close()
	w := csv.NewWriter(f)
	_ = w.Write([]string{"username", "model", "request_id", "created_at", "prompt_tokens", "completion_tokens", "amount", "currency", "sync_or_async"})
	rate := operation_setting.GetUsdToCurrencyRate( operation_setting.USDExchangeRate )
	if rate <= 0 { rate = 1 }
	currency := operation_setting.GetCurrencySymbol()
	if currency == "" { currency = "USD" }
	beijing := time.FixedZone("Asia/Shanghai", 8*60*60)
	for _, g := range groups {
		if g.Quota <= 0 { continue }
		mode := "sync"; if g.Async { mode = "async" }
		amount := float64(g.Quota) / common.QuotaPerUnit * rate
		createdAt := time.Unix(g.Created, 0).In(beijing).Format("2006-01-02 15:04:05")
		_ = w.Write([]string{g.User, g.Model, g.Request, createdAt, strconv.FormatInt(g.Prompt, 10), strconv.FormatInt(g.Completion, 10), strconv.FormatFloat(amount, 'f', 6, 64), currency, mode})
	}
	w.Flush(); if err := w.Error(); err != nil { return UsageExportResult{}, err }
	return UsageExportResult{File:path, Rows:len(groups)}, nil
}
