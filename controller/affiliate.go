package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AffiliateUser is the deliberately small, non-admin representation exposed
// to an inviter. Keep this DTO separate from model.User to prevent accidental
// exposure of credentials, bindings, settings, or admin permissions.
type AffiliateUser struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Status      int    `json:"status"`
	Role        int    `json:"role"`
	Quota       int    `json:"quota"`
	UsedQuota   int    `json:"used_quota"`
	Group       string `json:"group"`
	InviterId   int    `json:"inviter_id"`
	AffCount    int    `json:"aff_count"`
	AffHistoryQuota int `json:"aff_history_quota"`
	CreatedAt   int64  `json:"created_at"`
	LastLoginAt int64  `json:"last_login_at"`
}

func affiliateDTO(u *model.User) AffiliateUser {
	return AffiliateUser{Id: u.Id, Username: u.Username, DisplayName: u.DisplayName,
		Status: u.Status, Role: u.Role, Quota: u.Quota, UsedQuota: u.UsedQuota,
		Group: u.Group, InviterId: u.InviterId, AffCount: u.AffCount,
		AffHistoryQuota: u.AffHistoryQuota, CreatedAt: u.CreatedAt, LastLoginAt: u.LastLoginAt}
}

func parseAffiliateTarget(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "invalid user id")
		return 0, false
	}
	var count int64
	model.DB.Model(&model.User{}).Where("id = ? AND inviter_id = ? AND deleted_at IS NULL", id, c.GetInt("id")).Count(&count)
	if count == 0 {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "target is not your direct subordinate"})
		return 0, false
	}
	return id, true
}

func GetAffiliateUsers(c *gin.Context) {
	page := common.GetPageQuery(c)
	query := model.DB.Model(&model.User{}).Where("inviter_id = ? AND deleted_at IS NULL", c.GetInt("id"))
	if keyword := strings.TrimSpace(c.Query("keyword")); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("username LIKE ? OR display_name LIKE ?", like, like)
	}
	if group := strings.TrimSpace(c.Query("group")); group != "" {
		query = query.Where("(`group` = ? OR `group` LIKE ? OR `group` LIKE ? OR `group` LIKE ?)", group, group+",%", "%,"+group, "%,"+group+",%")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil { common.ApiError(c, err); return }
	var users []*model.User
	if err := query.Omit("password", "access_token").Order("id DESC").Limit(page.GetPageSize()).Offset(page.GetStartIdx()).Find(&users).Error; err != nil { common.ApiError(c, err); return }
	items := make([]AffiliateUser, 0, len(users))
	for _, u := range users { items = append(items, affiliateDTO(u)) }
	page.SetTotal(int(total)); page.SetItems(items)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"items": items, "total": total, "page": page.Page, "page_size": page.PageSize}})
}

func GetAffiliateGroups(c *gin.Context) {
	u, err := model.GetUserById(c.GetInt("id"), false)
	if err != nil { common.ApiError(c, err); return }
	groups := service.SplitUserGroups(u.Group)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": groups})
}

func GetAffiliateUser(c *gin.Context) {
	id, ok := parseAffiliateTarget(c); if !ok { return }
	u, err := model.GetUserById(id, false); if err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": affiliateDTO(u)})
}

func GetAffiliateConsumption(c *gin.Context) {
	id, ok := parseAffiliateTarget(c); if !ok { return }
	u, err := model.GetUserById(id, false); if err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"quota": u.Quota, "used_quota": u.UsedQuota, "total_quota": u.Quota + u.UsedQuota,
		"request_count": u.RequestCount,
	}})
}

func GetAffiliateConsumptionData(c *gin.Context) {
	id, ok := parseAffiliateTarget(c)
	if !ok {
		return
	}
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	dates, err := model.GetQuotaDataByUserId(id, startTimestamp, endTimestamp, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": dates})
}

type affiliateTransferRequest struct { Quota int `json:"quota" binding:"required,gt=0"` }

func TransferAffiliateQuota(c *gin.Context) {
	id, ok := parseAffiliateTarget(c); if !ok { return }
	var req affiliateTransferRequest
	if err := c.ShouldBindJSON(&req); err != nil { common.ApiErrorMsg(c, "quota must be a positive integer"); return }
	sourceID := c.GetInt("id")
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var source, target model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&source, "id = ? AND deleted_at IS NULL", sourceID).Error; err != nil { return err }
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&target, "id = ? AND inviter_id = ? AND deleted_at IS NULL", id, sourceID).Error; err != nil { return fmt.Errorf("target is not your direct subordinate") }
		if source.Quota < req.Quota { return fmt.Errorf("insufficient quota") }
		if err := tx.Model(&model.User{}).Where("id = ? AND quota >= ?", sourceID, req.Quota).Update("quota", gorm.Expr("quota - ?", req.Quota)).Error; err != nil { return err }
		return tx.Model(&model.User{}).Where("id = ?", id).Update("quota", gorm.Expr("quota + ?", req.Quota)).Error
	})
	if err != nil { common.ApiError(c, err); return }
	_ = model.InvalidateUserCache(sourceID); _ = model.InvalidateUserCache(id)
	model.RecordLog(sourceID, model.LogTypeManage, fmt.Sprintf("affiliate quota transfer: %d -> %d (%d)", sourceID, id, req.Quota))
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"quota": req.Quota}})
}

type affiliateGroupsRequest struct { Groups []string `json:"groups" binding:"required,min=1"` }

func AddAffiliateGroups(c *gin.Context) {
	id, ok := parseAffiliateTarget(c); if !ok { return }
	var req affiliateGroupsRequest
	if err := c.ShouldBindJSON(&req); err != nil { common.ApiErrorMsg(c, "groups must not be empty"); return }
	operator, err := model.GetUserById(c.GetInt("id"), false); if err != nil { common.ApiError(c, err); return }
	assignable := map[string]bool{}
	for _, group := range service.SplitUserGroups(operator.Group) { assignable[group] = true }
	requested := make([]string, 0, len(req.Groups)); seen := map[string]bool{}
	for _, g := range req.Groups { g = strings.TrimSpace(g); if g == "" || seen[g] { continue }; seen[g] = true; if !assignable[g] { common.ApiErrorMsg(c, "group is not assignable by you"); return }; requested = append(requested, g) }
	if len(requested) == 0 { common.ApiErrorMsg(c, "groups must not be empty"); return }
	var target model.User
	if err := model.DB.First(&target, "id = ? AND inviter_id = ? AND deleted_at IS NULL", id, operator.Id).Error; err != nil { common.ApiError(c, err); return }
	groups := service.SplitUserGroups(target.Group); have := map[string]bool{}; for _, g := range groups { have[g] = true }
	for _, g := range requested { if !have[g] { groups = append(groups, g) } }
	newGroup := strings.Join(groups, ",")
	if err := model.DB.Model(&model.User{}).Where("id = ? AND inviter_id = ?", id, operator.Id).Update("group", newGroup).Error; err != nil { common.ApiError(c, err); return }
	_ = model.InvalidateUserCache(id)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"group": newGroup}})
}
