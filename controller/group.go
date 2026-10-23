package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

func GetGroups(c *gin.Context) {
	groupNames := make([]string, 0)
	for groupName := range ratio_setting.GetGroupRatioCopy() {
		groupNames = append(groupNames, groupName)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    groupNames,
	})
}

func GetUserGroups(c *gin.Context) {
	usableGroups := make(map[string]map[string]interface{})
	userGroup := ""
	userId := c.GetInt("id")
	userGroup, _ = model.GetUserGroup(userId, false)
	var restricted []string
	var additionalAuthorizedGroups []string
	if user, err := model.GetUserCache(userId); err == nil {
		userSettings := user.GetSetting()
		restricted = userSettings.RestrictedPublicGroups
		additionalAuthorizedGroups = userSettings.AuthorizedGroups
	}
	userUsableGroups := service.GetUserUsableGroupsWithRestrictions(userGroup, restricted)
	authorized := service.GetUserAuthorizedGroups(userGroup, additionalAuthorizedGroups)
	authorizationRequiredGroups := setting.GetAuthorizationRequiredGroupsCopy()
	for groupName, _ := range ratio_setting.GetGroupRatioCopy() {
		if desc, ok := userUsableGroups[groupName]; ok {
			_, hasAuthorization := authorized[groupName]
			usableGroups[groupName] = map[string]interface{}{
				"ratio":                  service.GetUserGroupRatio(userGroup, groupName),
				"desc":                   desc,
				"authorization_required": authorizationRequiredGroups[groupName],
				"authorized":             !authorizationRequiredGroups[groupName] || hasAuthorization,
			}
		}
	}
	if _, ok := userUsableGroups["auto"]; ok {
		usableGroups["auto"] = map[string]interface{}{
			"ratio": "自动",
			"desc":  setting.GetUsableGroupDescription("auto"),
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    usableGroups,
	})
}
