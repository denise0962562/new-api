package model

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

const taskFailureHealthResetWindow = 10 * time.Minute

type taskChannelHealthState struct {
	Failures      int
	LastFailureAt time.Time
}

var taskChannelHealth = struct {
	sync.RWMutex
	states map[string]taskChannelHealthState
}{states: make(map[string]taskChannelHealthState)}

func taskChannelHealthKey(channelID int, modelName string) string {
	return fmt.Sprintf("%d\x00%s", channelID, modelName)
}

func GetTaskChannelConsecutiveFailures(channelID int, modelName string) int {
	key := taskChannelHealthKey(channelID, modelName)
	now := time.Now()
	taskChannelHealth.RLock()
	state, ok := taskChannelHealth.states[key]
	taskChannelHealth.RUnlock()
	if !ok || now.Sub(state.LastFailureAt) >= taskFailureHealthResetWindow {
		if ok {
			taskChannelHealth.Lock()
			delete(taskChannelHealth.states, key)
			taskChannelHealth.Unlock()
		}
		return 0
	}
	return state.Failures
}

func RecordTaskChannelFailure(channelID int, modelName string) {
	key := taskChannelHealthKey(channelID, modelName)
	now := time.Now()
	taskChannelHealth.Lock()
	state := taskChannelHealth.states[key]
	if state.LastFailureAt.IsZero() || now.Sub(state.LastFailureAt) >= taskFailureHealthResetWindow {
		state.Failures = 0
	}
	state.Failures++
	state.LastFailureAt = now
	taskChannelHealth.states[key] = state
	taskChannelHealth.Unlock()
}

func RecordTaskChannelSuccess(channelID int, modelName string) {
	key := taskChannelHealthKey(channelID, modelName)
	taskChannelHealth.Lock()
	delete(taskChannelHealth.states, key)
	taskChannelHealth.Unlock()
}

type TaskChannelHealth struct {
	ChannelID           int    `json:"channel_id"`
	ModelName           string `json:"model_name"`
	ConsecutiveFailures int    `json:"consecutive_failures"`
	LastFailureAt       int64  `json:"last_failure_at,omitempty"`
}

func ResetTaskChannelHealth(channelID int, modelName string) {
	taskChannelHealth.Lock()
	delete(taskChannelHealth.states, taskChannelHealthKey(channelID, modelName))
	taskChannelHealth.Unlock()
}

func ResetTaskChannelHealthByModel(modelName string) {
	taskChannelHealth.Lock()
	for key := range taskChannelHealth.states {
		if strings.HasSuffix(key, "\x00"+modelName) {
			delete(taskChannelHealth.states, key)
		}
	}
	taskChannelHealth.Unlock()
}

func ListTaskChannelHealth(channelID int, channelModels string) []TaskChannelHealth {
	models := make(map[string]struct{})
	for _, modelName := range strings.Split(channelModels, ",") {
		modelName = strings.TrimSpace(modelName)
		if modelName != "" {
			models[modelName] = struct{}{}
		}
	}
	taskChannelHealth.RLock()
	stateKeys := make([]string, 0, len(taskChannelHealth.states))
	for key := range taskChannelHealth.states {
		stateKeys = append(stateKeys, key)
	}
	taskChannelHealth.RUnlock()
	for _, key := range stateKeys {
		prefix := fmt.Sprintf("%d\x00", channelID)
		if strings.HasPrefix(key, prefix) {
			models[strings.TrimPrefix(key, prefix)] = struct{}{}
		}
	}
	result := make([]TaskChannelHealth, 0, len(models))
	for modelName := range models {
		state := TaskChannelHealth{ChannelID: channelID, ModelName: modelName}
		key := taskChannelHealthKey(channelID, modelName)
		taskChannelHealth.RLock()
		value, ok := taskChannelHealth.states[key]
		taskChannelHealth.RUnlock()
		if ok && time.Since(value.LastFailureAt) < taskFailureHealthResetWindow {
			state.ConsecutiveFailures = value.Failures
			state.LastFailureAt = value.LastFailureAt.Unix()
		}
		result = append(result, state)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ConsecutiveFailures != result[j].ConsecutiveFailures {
			return result[i].ConsecutiveFailures > result[j].ConsecutiveFailures
		}
		return result[i].ModelName < result[j].ModelName
	})
	return result
}
