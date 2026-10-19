package doubao

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func TestConvertToRequestPayloadPreservesToolParameters(t *testing.T) {
	req := relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-5-260628",
		Prompt: "test prompt",
		Metadata: map[string]interface{}{
			"tools": []interface{}{
				map[string]interface{}{
					"type": "function",
					"function": map[string]interface{}{
						"name": "search",
						"parameters": map[string]interface{}{
							"type": "object",
						},
					},
				},
			},
		},
	}

	body, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
	if err != nil {
		t.Fatalf("convertToRequestPayload() error = %v", err)
	}
	if len(body.Tools) != 1 {
		t.Fatalf("Tools length = %d, want 1", len(body.Tools))
	}
	function, ok := body.Tools[0]["function"].(map[string]interface{})
	if !ok {
		t.Fatalf("Tools[0].function = %#v, want nested object", body.Tools[0]["function"])
	}
	if function["name"] != "search" {
		t.Fatalf("Tools[0].function.name = %#v, want search", function["name"])
	}
	parameters, ok := function["parameters"].(map[string]interface{})
	if !ok || parameters["type"] != "object" {
		t.Fatalf("Tools[0].function.parameters = %#v, want object schema", function["parameters"])
	}
}

func TestConvertToRequestPayloadPreservesUsePersonCharacter(t *testing.T) {
	req := relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-5-260628",
		Prompt: "test prompt",
		Metadata: map[string]interface{}{
			"use_person_character": true,
		},
	}

	body, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
	if err != nil {
		t.Fatalf("convertToRequestPayload() error = %v", err)
	}
	if body.UsePersonCharacter == nil || !bool(*body.UsePersonCharacter) {
		t.Fatalf("UsePersonCharacter = %v, want true", body.UsePersonCharacter)
	}
}

func TestConvertToRequestPayloadPreservesOmniReferenceTaskType(t *testing.T) {
	req := relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-0-mini-260615",
		Prompt: "他们在跳舞",
		Metadata: map[string]interface{}{
			"omni_reference_task_type": "auto",
		},
	}

	body, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
	if err != nil {
		t.Fatalf("convertToRequestPayload() error = %v", err)
	}
	if body.OmniReferenceTaskType != "auto" {
		t.Fatalf("OmniReferenceTaskType = %q, want auto", body.OmniReferenceTaskType)
	}
}

func TestConvertToRequestPayloadPreservesDraftAndDraftTask(t *testing.T) {
	falseValue := false
	req := relaycommon.TaskSubmitReq{
		Model:  "doubao-seedance-2-0-fast-260128",
		Prompt: "test prompt",
		Metadata: map[string]interface{}{
			"draft": &falseValue,
			"content": []interface{}{
				map[string]interface{}{
					"type": "draft_task",
					"draft_task": map[string]interface{}{"id": "xxxxx"},
				},
			},
		},
	}

	body, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
	if err != nil {
		t.Fatalf("convertToRequestPayload() error = %v", err)
	}
	if body.Draft == nil || bool(*body.Draft) {
		t.Fatalf("Draft = %v, want explicit false", body.Draft)
	}
	var draftTask map[string]any
	for _, item := range body.Content {
		if item.Type == "draft_task" {
			draftTask = item.DraftTask
		}
	}
	if draftTask == nil || draftTask["id"] != "xxxxx" {
		t.Fatalf("DraftTask = %#v, want id xxxxx", draftTask)
	}
}

func TestConvertToRequestPayloadDoesNotAddEmptyTextForDraftTask(t *testing.T) {
	req := relaycommon.TaskSubmitReq{
		Model: "doubao-seedance-2-5-260628",
		Metadata: map[string]interface{}{
			"draft": true,
			"content": []interface{}{
				map[string]interface{}{
					"type":       "draft_task",
					"draft_task": map[string]interface{}{"id": "cgt-20261019125019-8lwc9"},
				},
			},
		},
	}

	body, err := (&TaskAdaptor{}).convertToRequestPayload(&req)
	if err != nil {
		t.Fatalf("convertToRequestPayload() error = %v", err)
	}
	if len(body.Content) != 1 || body.Content[0].Type != "draft_task" {
		t.Fatalf("Content = %#v, want only the draft_task item", body.Content)
	}
}
