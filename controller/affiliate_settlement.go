package controller

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

func ListAffiliateRules(c *gin.Context) {
	salesID := c.GetInt("id")
	if c.GetInt("role") == common.RoleRootUser {
		salesID, _ = strconv.Atoi(c.Query("sales_id"))
	}
	type ruleRow struct {
		model.AffiliateCommissionRule
		SalesUsername string `json:"sales_username"`
		SalesDisplayName string `json:"sales_display_name"`
	}
	var rows []ruleRow
	q := model.DB.Table("affiliate_commission_rules AS r").Select("r.*, u.username AS sales_username, u.display_name AS sales_display_name").Joins("LEFT JOIN users u ON u.id = r.sales_id").Order("r.sales_id, r.group_name")
	if salesID > 0 { q = q.Where("r.sales_id = ?", salesID) }
	if err := q.Scan(&rows).Error; err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": rows})
}

func SearchAffiliateSalesUsers(c *gin.Context) {
	if c.GetInt("role") != common.RoleRootUser { common.ApiErrorMsg(c, "root permission required"); return }
	keyword := strings.TrimSpace(c.Query("keyword"))
	if keyword == "" { c.JSON(http.StatusOK, gin.H{"success": true, "data": []interface{}{}}); return }
	query := model.DB.Model(&model.User{}).Select("id, username, display_name, role, status").Where("deleted_at IS NULL")
	like := "%" + keyword + "%"
	if id, err := strconv.Atoi(keyword); err == nil { query = query.Where("id = ? OR username LIKE ? OR display_name LIKE ?", id, like, like) } else { query = query.Where("username LIKE ? OR display_name LIKE ?", like, like) }
	var users []struct { Id int `json:"id"`; Username string `json:"username"`; DisplayName string `json:"display_name"`; Role int `json:"role"`; Status int `json:"status"` }
	if err := query.Order("id DESC").Limit(20).Find(&users).Error; err != nil { common.ApiError(c, err); return }
	c.JSON(http.StatusOK, gin.H{"success": true, "data": users})
}

func SaveAffiliateRule(c *gin.Context) { var req struct{ SalesID int `json:"sales_id"`; GroupName string `json:"group_name"`; RateBps int `json:"rate_bps"`; Enabled *bool `json:"enabled"`; Remark string `json:"remark"` }; if err:=common.DecodeJson(c.Request.Body,&req); err!=nil { common.ApiError(c,err); return }; if c.GetInt("role") != common.RoleRootUser { common.ApiErrorMsg(c,"root permission required"); return }; if req.SalesID<=0 || strings.TrimSpace(req.GroupName)=="" { common.ApiErrorMsg(c,"sales and group are required"); return }; if err:=model.ValidateAffiliateRate(req.RateBps); err!=nil { common.ApiError(c,err); return }; enabled:=true; if req.Enabled!=nil { enabled=*req.Enabled }; var row model.AffiliateCommissionRule; err:=model.DB.Where("sales_id = ? AND group_name = ?",req.SalesID,strings.TrimSpace(req.GroupName)).First(&row).Error; if err==nil { row.RateBps=req.RateBps; row.Enabled=enabled; row.Remark=req.Remark; err=model.DB.Save(&row).Error } else { row=model.AffiliateCommissionRule{SalesId:req.SalesID,GroupName:strings.TrimSpace(req.GroupName),RateBps:req.RateBps,Enabled:enabled,Remark:req.Remark}; err=model.DB.Create(&row).Error }; if err!=nil { common.ApiError(c,err); return }; c.JSON(http.StatusOK,gin.H{"success":true,"data":row}) }

type settlementItemRequest struct { GroupName string `json:"group_name"`; Quota int64 `json:"quota"`; RateBps int `json:"rate_bps"`; Commission int64 `json:"commission"` }
func PreviewAffiliateSettlement(c *gin.Context) { target,ok:=parseAffiliateTarget(c); if !ok{return}; end,_:=strconv.ParseInt(c.Query("end_at"),10,64); if end==0 { end=time.Now().AddDate(0,0,-1).Truncate(24*time.Hour).Unix()+24*60*60 }; start,_:=strconv.ParseInt(c.Query("start_at"),10,64); if start==0 { start=0 }; var rules []model.AffiliateCommissionRule; model.DB.Where("sales_id = ? AND enabled = ?",c.GetInt("id"),true).Find(&rules); allowed:=map[string]model.AffiliateCommissionRule{}; for _,r:=range rules {allowed[r.GroupName]=r}; rows,err:=model.GetAvailableAffiliateSettlementQuota(model.DB,target,start,end); if err!=nil {common.ApiError(c,err);return}; items:=[]settlementItemRequest{}; var total,commission int64; for _,r:=range rows { rule,yes:=allowed[r.GroupName]; if !yes || r.Quota<=0 {continue}; amount:=r.Quota*int64(rule.RateBps)/10000; items=append(items,settlementItemRequest{GroupName:r.GroupName,Quota:r.Quota,RateBps:rule.RateBps,Commission:amount}); total+=r.Quota; commission+=amount }; c.JSON(http.StatusOK,gin.H{"success":true,"data":gin.H{"start_at":start,"end_at":end,"total_quota":total,"total_commission":commission,"currency":operation_setting.GetQuotaDisplayType(),"items":items}}) }

func CreateAffiliateSettlement(c *gin.Context) { var req struct{ TargetUserID int `json:"target_user_id"`; StartAt int64 `json:"start_at"`; EndAt int64 `json:"end_at"`; Remark string `json:"remark"`; PaymentType string `json:"payment_type"`; PaymentNote string `json:"payment_note"`; AttachmentKeys []string `json:"attachment_keys"`; TotalQuota int64 `json:"total_quota"`; TotalCommission int64 `json:"total_commission"`; Items []settlementItemRequest `json:"items"` }; if err:=common.DecodeJson(c.Request.Body,&req); err!=nil {common.ApiError(c,err);return}; if len(req.Items)==0 || req.EndAt<=req.StartAt {common.ApiErrorMsg(c,"no eligible consumption");return}; if req.EndAt > time.Now().Truncate(24*time.Hour).Unix() { common.ApiErrorMsg(c,"settlement end date must be before today"); return }; target,ok:=parseAffiliateTargetByID(c,req.TargetUserID); if !ok{return}; _=target; var rules []model.AffiliateCommissionRule; model.DB.Where("sales_id = ? AND enabled = ?",c.GetInt("id"),true).Find(&rules); ruleMap:=map[string]model.AffiliateCommissionRule{}; for _,r:=range rules {ruleMap[r.GroupName]=r}; dbRows,err:=model.GetAvailableAffiliateSettlementQuota(model.DB,req.TargetUserID,req.StartAt,req.EndAt); if err!=nil {common.ApiError(c,err);return}; actual:=map[string]int64{}; for _,r:=range dbRows {actual[r.GroupName]=r.Quota}; var computedTotal,computedCommission int64; for _,i:=range req.Items {rule,yes:=ruleMap[i.GroupName]; if !yes || actual[i.GroupName]<=0 || i.RateBps!=rule.RateBps || i.Quota!=actual[i.GroupName] {common.ApiErrorMsg(c,"settlement details have changed, please refresh");return}; expected:=i.Quota*int64(i.RateBps)/10000; if i.Commission!=expected {common.ApiErrorMsg(c,"invalid commission amount");return}; computedTotal+=i.Quota; computedCommission+=expected }; if computedTotal!=req.TotalQuota || computedCommission!=req.TotalCommission {common.ApiErrorMsg(c,"invalid settlement total");return}; var keys string; b,_:=json.Marshal(req.AttachmentKeys); keys=string(b); app:=&model.AffiliateSettlementApplication{SalesId:c.GetInt("id"),TargetUserId:req.TargetUserID,StartAt:req.StartAt,EndAt:req.EndAt,TotalQuota:req.TotalQuota,TotalCommission:req.TotalCommission,Currency:operation_setting.GetQuotaDisplayType(),Remark:req.Remark,PaymentType:req.PaymentType,PaymentNote:req.PaymentNote,AttachmentKeys:keys}; for _,i:=range req.Items { app.Items=append(app.Items,model.AffiliateSettlementItem{GroupName:i.GroupName,Quota:i.Quota,RateBps:i.RateBps,Commission:i.Commission}) }; if err:=model.CreateAffiliateSettlement(app);err!=nil{common.ApiError(c,err);return}; c.JSON(http.StatusOK,gin.H{"success":true,"data":app}) }

func parseAffiliateTargetByID(c *gin.Context,id int)(int,bool){ var n int64; model.DB.Model(&model.User{}).Where("id = ? AND inviter_id = ? AND deleted_at IS NULL",id,c.GetInt("id")).Count(&n); if n==0 {common.ApiErrorMsg(c,"target is not your direct subordinate");return 0,false}; return id,true }

type affiliateSettlementListItem struct {
	model.AffiliateSettlementApplication
	SalesUsername string `json:"sales_username"`
	SalesDisplayName string `json:"sales_display_name"`
	TargetUsername string `json:"target_username"`
	TargetDisplayName string `json:"target_display_name"`
	AttachmentURLs []string `json:"attachment_urls"`
}

func ListAffiliateSettlements(c *gin.Context){
	q:=model.DB.Model(&model.AffiliateSettlementApplication{}).Preload("Items").Order("id DESC")
	if c.GetInt("role")!=common.RoleRootUser {q=q.Where("sales_id = ?",c.GetInt("id"))}
	var rows []model.AffiliateSettlementApplication
	if err:=q.Find(&rows).Error;err!=nil{common.ApiError(c,err);return}
	config:=service.QuotaApplicationR2ConfigFromOptions()
	result:=make([]affiliateSettlementListItem,0,len(rows))
	for _,row:=range rows {
		item:=affiliateSettlementListItem{AffiliateSettlementApplication:row,AttachmentURLs:[]string{}}
		var sales,target model.User
		model.DB.Select("id, username, display_name").First(&sales,row.SalesId)
		model.DB.Select("id, username, display_name").First(&target,row.TargetUserId)
		item.SalesUsername=sales.Username; item.SalesDisplayName=sales.DisplayName
		item.TargetUsername=target.Username; item.TargetDisplayName=target.DisplayName
		var keys []string
		if json.Unmarshal([]byte(row.AttachmentKeys),&keys)==nil { for _,key:=range keys { if key!="" { item.AttachmentURLs=append(item.AttachmentURLs,service.R2ObjectURL(config,key)) } } }
		result=append(result,item)
	}
	c.JSON(http.StatusOK,gin.H{"success":true,"data":result})
}

func GetAffiliateSettlementConsumption(c *gin.Context) {
	id,err:=strconv.Atoi(c.Param("id")); if err!=nil || id<=0 { common.ApiErrorMsg(c,"invalid settlement id"); return }
	var app model.AffiliateSettlementApplication
	if err:=model.DB.First(&app,id).Error; err!=nil { common.ApiError(c,err); return }
	if c.GetInt("role")!=common.RoleRootUser && app.SalesId!=c.GetInt("id") { c.JSON(http.StatusForbidden,gin.H{"success":false,"message":"permission denied"}); return }
	start,_:=strconv.ParseInt(c.Query("start_timestamp"),10,64); end,_:=strconv.ParseInt(c.Query("end_timestamp"),10,64)
	dates,err:=model.GetQuotaDataByUserId(app.TargetUserId,start,end,true); if err!=nil {common.ApiError(c,err);return}
	c.JSON(http.StatusOK,gin.H{"success":true,"data":dates})
}
func ReviewAffiliateSettlement(c *gin.Context){ if c.GetInt("role")!=common.RoleRootUser {common.ApiErrorMsg(c,"root permission required");return}; id,_:=strconv.Atoi(c.Param("id")); var req struct{Approved bool `json:"approved"`; Comment string `json:"comment"`; Paid bool `json:"paid"`}; if err:=common.DecodeJson(c.Request.Body,&req);err!=nil{common.ApiError(c,err);return}; a,err:=model.LoadAffiliateSettlement(id);if err!=nil{common.ApiError(c,err);return}; if req.Paid {a.Status=model.AffiliateSettlementPaid;a.PaidAt=time.Now().Unix();a.PaidBy=c.GetInt("id")} else if req.Approved {a.Status=model.AffiliateSettlementApproved;a.ReviewedAt=time.Now().Unix();a.ReviewedBy=c.GetInt("id")} else {a.Status=model.AffiliateSettlementRejected}; a.ReviewComment=req.Comment; if err=model.DB.Save(a).Error;err!=nil{common.ApiError(c,err);return}; c.JSON(http.StatusOK,gin.H{"success":true,"data":a}) }
