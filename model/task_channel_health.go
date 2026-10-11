package model

import (
	"fmt"
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
