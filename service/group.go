package service

import (
	"strings"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func SplitUserGroups(userGroup string) []string {
	if userGroup == "" {
		return nil
	}
	parts := strings.Split(userGroup, ",")
	groups := make([]string, 0, len(parts))
	seen := make(map[string]bool, len(parts))
	for _, part := range parts {
		group := strings.TrimSpace(part)
		if group == "" || seen[group] {
			continue
		}
		seen[group] = true
		groups = append(groups, group)
	}
	return groups
}

func GetUserUsableGroups(userGroup string) map[string]string {
	return GetUserUsableGroupsWithRestrictions(userGroup, nil)
}

func GetUserUsableGroupsWithRestrictions(userGroup string, restricted []string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	restrictedSet := make(map[string]struct{}, len(restricted))
	for _, group := range restricted { if group = strings.TrimSpace(group); group != "" { restrictedSet[group] = struct{}{} } }
	assigned := make(map[string]struct{})
	for _, group := range SplitUserGroups(userGroup) {
		assigned[group] = struct{}{}
		specialSettings, ok := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(group)
		if ok {
			for specialGroup, desc := range specialSettings {
				if strings.HasPrefix(specialGroup, "-:") {
					groupToRemove := strings.TrimPrefix(specialGroup, "-:")
					delete(groupsCopy, groupToRemove)
				} else if strings.HasPrefix(specialGroup, "+:") {
					groupToAdd := strings.TrimPrefix(specialGroup, "+:")
					groupsCopy[groupToAdd] = desc
				} else {
					groupsCopy[specialGroup] = desc
				}
			}
		}
		if _, ok := groupsCopy[group]; !ok {
			groupsCopy[group] = "用户分组"
		}
	}
	for group := range restrictedSet { if _, ok := assigned[group]; !ok { delete(groupsCopy, group) } }
	return groupsCopy
}

// GetUserAuthorizedGroups returns user group permissions augmented with groups
// assigned to the user by an administrator.
func GetUserAuthorizedGroups(userGroup string, additionalGroups []string) map[string]struct{} {
	authorized := make(map[string]struct{})
	for _, group := range SplitUserGroups(userGroup) {
		authorized[group] = struct{}{}
	}
	for _, group := range additionalGroups {
		if group = strings.TrimSpace(group); group != "" {
			authorized[group] = struct{}{}
		}
	}
	return authorized
}

func UserCanUseGroup(userGroup string, restricted, additionalGroups []string, targetGroup string) bool {
	if _, usable := GetUserUsableGroupsWithRestrictions(userGroup, restricted)[targetGroup]; !usable {
		return false
	}
	if !setting.GetAuthorizationRequiredGroupsCopy()[targetGroup] {
		return true
	}
	_, authorized := GetUserAuthorizedGroups(userGroup, additionalGroups)[targetGroup]
	return authorized
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func GetUserAutoGroup(userGroup string) []string {
	return GetUserAutoGroupWithRestrictions(userGroup, nil)
}

func GetUserAutoGroupWithRestrictions(userGroup string, restricted []string) []string {
	groups := GetUserUsableGroupsWithRestrictions(userGroup, restricted)
	autoGroups := make([]string, 0)
	for _, group := range setting.GetAutoGroups() {
		if _, ok := groups[group]; ok {
			autoGroups = append(autoGroups, group)
		}
	}
	return autoGroups
}

// GetUserGroupRatio returns the effective ratio for a user group selecting a target group.
func GetUserGroupRatio(userGroup, group string) float64 {
	for _, userGroup := range SplitUserGroups(userGroup) {
		ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
		if ok {
			return ratio
		}
	}
	return ratio_setting.GetGroupRatio(group)
}
