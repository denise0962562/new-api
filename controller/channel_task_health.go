package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetChannelTaskHealth(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid channel id"})
		return
	}
	channel, err := model.CacheGetChannel(channelID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
		return
	}
	items := model.ListTaskChannelHealth(channelID, channel.Models)
	for i := range items {
		items[i].ChannelID = channelID
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"channel_id": channelID,
		"channel_name": channel.Name,
		"items": items,
	}})
}

func ResetChannelTaskHealth(c *gin.Context) {
	channelID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid channel id"})
		return
	}
	var request struct {
		ModelName string `json:"model_name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.ModelName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "model_name is required"})
		return
	}
	model.ResetTaskChannelHealth(channelID, request.ModelName)
	c.JSON(http.StatusOK, gin.H{"success": true})
}
