"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./utils/index");
const index_2 = require("../../index");
const utils_1 = require("../utils");
exports.default = {
    /**
     * 获取歌手信息
     * @param {*} id
     */
    getInfo(id) {
        return (0, index_1.eapiRequest)('/api/artist/head/info/get', { id }).promise.then(({ body }) => {
            if (!body || body.code != 200)
                throw new Error('get singer info faild.');
            // console.log('[wy]...getInfo:', JSON.stringify(body, null, 2))
            /*JSON例子如下:{
        "code": 200,
        "message": "ok",
        "data": {
          "videoCount": 116,
          "vipRights": {
            "rightsInfoDetailDtoList": [
              {
                "vipCode": 220,
                "expireTime": 1778169599000,
                "iconUrl": null,
                "dynamicIconUrl": null,
                "vipLevel": 0,
                "signIapDeduct": false,
                "signIap": false,
                "signDeduct": false,
                "sign": false
              },
              {
                "vipCode": 100,
                "expireTime": 1778169599000,
                "iconUrl": null,
                "dynamicIconUrl": null,
                "vipLevel": 0,
                "signIapDeduct": false,
                "signIap": false,
                "signDeduct": false,
                "sign": false
              }
            ],
            "oldProtocol": false,
            "redVipAnnualCount": -1,
            "redVipLevel": 1,
            "now": 1781315233889
          },
          "identify": {
            "imageUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/4788940880/1a1f/68f5/b59a/b444b81b88567108ba88194fa29144f5.png",
            "imageDesc": "原创歌手薛之谦",
            "actionUrl": "orpheus://rnpage?component=music-reactnative-artistwiki&split=index&artistId=5781"
          },
          "artist": {
            "id": 5781,
            "cover": "http://p2.music.126.net/Z2x6knGRr7eRrZeOlgCngA==/109951172414270313.jpg",
            "avatar": "http://p2.music.126.net/PLrMsE0bTG2p1lL6QfKC9g==/109951172414278510.jpg",
            "name": "薛之谦",
            "transNames": [],
            "alias": [
              "Joker Xue",
              "Jacky Xue"
            ],
            "identities": [
              "作词",
              "作曲"
            ],
            "identifyTag": [
              "入驻艺人"
            ],
            "briefDesc": "薛之谦（Joker Xue），1983年7月17日出生于上海，中国内地流行乐男歌手、影视演员、音乐制作人，毕业于格里昂酒店管理学院。\n2005年，因参加选秀节目《我型我秀》而正式出道。2006年，发行首张同名专辑《薛之谦》，随后凭借歌曲《认真的雪》获得广泛关注。2007年，凭借专辑《你过得好吗》获得MusicRadio中国TOP排行榜内地年度最受欢迎男歌手奖。2008年，发行专辑《深深爱过你》，同年在上海举行个人首场演唱会“谦年传说”。2013年，专辑《几个薛之谦》获得MusicRadio中国TOP排行榜内地推荐唱片。2014年，凭借专辑《意外》获得第21届东方风云榜颁奖最佳唱作人；同年他还获得音悦V榜年度盛典年度创作歌手奖。\n2015年6月，薛之谦首度担当制作人并发行原创EP《绅士》；同年，他还主演都市励志剧《妈妈像花儿一样》。2016年，凭借EP《绅士》、《一半》获得第16届全球华语歌曲排行榜最受欢迎男歌手、五大最受欢迎男歌手奖、上海地区杰出歌手奖及最受欢迎创作歌手奖，而歌曲《初学者》则获得年度二十大金曲奖。2017年4月，开启“我好像在哪见过你”全国巡回演唱会；同年，薛之谦获得第7届全球流行音乐年度盛典年度最佳男歌手及MusicRadio榜中国TOP排行榜内地最佳男歌手。\n2018年7月，薛之谦“摩天大楼”世界巡回演唱会于北京站启程，整个巡演横跨4大洲，8个国家，21个城市，累计上演场次23场。2020年12月31日，发行第11张个人专辑《天外来物》。",
            "rank": {
              "rank": 3,
              "type": 1
            },
            "albumSize": 27,
            "musicSize": 309,
            "mvSize": 115
          },
          "simpleUserIdentify": {
            "imageUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/4788940880/1a1f/68f5/b59a/b444b81b88567108ba88194fa29144f5.png",
            "imageDesc": "原创歌手薛之谦",
            "actionUrl": "orpheus://rnpage?component=music-reactnative-artistwiki&split=index&artistId=5781"
          },
          "blacklist": false,
          "preferShow": 5,
          "showPriMsg": true,
          "secondaryExpertIdentiy": [
            {
              "expertIdentiyId": 5,
              "expertIdentiyName": "演唱",
              "expertIdentiyCount": 308
            },
            {
              "expertIdentiyId": 6,
              "expertIdentiyName": "作词",
              "expertIdentiyCount": 277
            },
            {
              "expertIdentiyId": 7,
              "expertIdentiyName": "作曲",
              "expertIdentiyCount": 304
            },
            {
              "expertIdentiyId": 10,
              "expertIdentiyName": "编曲",
              "expertIdentiyCount": 10
            },
            {
              "expertIdentiyId": 11,
              "expertIdentiyName": "制作",
              "expertIdentiyCount": 3
            },
            {
              "expertIdentiyId": 1003270,
              "expertIdentiyName": "Beat",
              "expertIdentiyCount": 0
            },
            {
              "expertIdentiyId": 1002568,
              "expertIdentiyName": "演奏",
              "expertIdentiyCount": 0
            },
            {
              "expertIdentiyId": 105,
              "expertIdentiyName": "录音",
              "expertIdentiyCount": 0
            },
            {
              "expertIdentiyId": 106,
              "expertIdentiyName": "混音",
              "expertIdentiyCount": 0
            }
          ],
          "eventCount": 18,
          "user": {
            "backgroundUrl": "http://p1.music.126.net/Z2x6knGRr7eRrZeOlgCngA==/109951172414270313.jpg",
            "birthday": -2209017600000,
            "detailDescription": "原创歌手薛之谦",
            "authenticated": true,
            "gender": 1,
            "city": 110101,
            "signature": null,
            "description": "原创歌手薛之谦",
            "remarkName": null,
            "shortUserName": "薛之谦",
            "accountStatus": 0,
            "locationStatus": 10,
            "avatarImgId": 109951172414278510,
            "defaultAvatar": false,
            "province": 110000,
            "nickname": "薛之谦",
            "expertTags": null,
            "djStatus": 10,
            "avatarUrl": "http://p1.music.126.net/PLrMsE0bTG2p1lL6QfKC9g==/109951172414278510.jpg",
            "accountType": 1,
            "authStatus": 1,
            "vipType": 0,
            "userName": "薛之谦",
            "followed": false,
            "userId": 97137413,
            "lastLoginIP": "",
            "lastLoginTime": 1781289841787,
            "authenticationTypes": 4098,
            "mutual": false,
            "createTime": 1450170569106,
            "anchor": true,
            "authority": 0,
            "backgroundImgId": 109951172414270320,
            "userType": 2,
            "experts": null,
            "avatarDetail": {
              "userType": 2,
              "identityLevel": 1,
              "identityIconUrl": "https://p5.music.126.net/obj/wo3DlcOGw6DClTvDisK1/4788940880/1a1f/68f5/b59a/b444b81b88567108ba88194fa29144f5.png"
            }
          }
        }
      }*/
            return {
                source: 'wy',
                id: body.data.artist.id,
                info: {
                    name: body.data.artist.name,
                    desc: body.data.artist.briefDesc,
                    avatar: body.data.user.avatarUrl,
                    gender: body.data.user.gender === 1 ? 'man' : 'woman',
                },
                count: {
                    music: body.data.artist.musicSize,
                    album: body.data.artist.albumSize,
                },
            };
        });
    },
    /**
     * 获取歌手歌曲列表
     * @param {*} id
     * @param {*} page
     * @param {*} limit
     */
    getSongList(id, page = 1, limit = 100) {
        if (page === 1)
            page = 0;
        return (0, index_1.eapiRequest)('/api/v2/artist/songs', {
            id,
            limit,
            offset: limit * page,
        }).promise.then(({ body }) => {
            if (!body.songs || body.code != 200)
                throw new Error('get singer song list faild.');
            const list = this.filterSongList(body.songs);
            return {
                list,
                limit,
                page,
                total: body.total,
                source: 'wy',
            };
        });
    },
    /**
     * 获取歌手专辑列表
     * @param {*} id
     * @param {*} page
     * @param {*} limit
     */
    getAlbumList(id, page = 1, limit = 10) {
        if (page === 1)
            page = 0;
        return (0, index_1.eapiRequest)(`/api/artist/albums/${id}`, {
            limit,
            offset: limit * page,
        }).promise.then(({ body }) => {
            if (!body.hotAlbums || body.code != 200)
                throw new Error('get singer album list faild.');
            const list = this.filterAlbumList(body.hotAlbums);
            return {
                source: 'wy',
                list,
                limit,
                page,
                total: body.artist.albumSize,
            };
        });
    },
    filterAlbumList(raw) {
        const list = [];
        raw.forEach(item => {
            if (!item.id)
                return;
            list.push({
                id: item.id,
                count: item.size,
                info: {
                    name: item.name,
                    author: (0, utils_1.formatSingerName)(item.artists),
                    img: item.picUrl,
                    desc: null,
                },
            });
        });
        return list;
    },
    filterSongList(raw) {
        const list = [];
        raw.forEach(item => {
            if (!item.id)
                return;
            /* JSON 例子:{
              "starred": false,
                "popularity": 100,
                "starredNum": 0,
                "playedNum": 0,
                "dayPlays": 0,
                "hearTime": 0,
                "mp3Url": "http://m2.music.126.net/hmZoNQaqzZALvVp0rE7faA==/0.mp3",
                "rtUrls": null,
                "mark": 17716813824,
                "noCopyrightRcmd": null,
                "originCoverType": 0,
                "originSongSimpleData": null,
                "artistClassics": false,
                "songJumpInfo": null,
                "artists": [
              {
                "img1v1Id": 18686200114669624,
                "topicPerson": 0,
                "picId": 0,
                "briefDesc": "",
                "musicSize": 0,
                "albumSize": 0,
                "followed": false,
                "picUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg",
                "img1v1Url": "http://p1.music.126.net/VnZiScyynLG7atLIZ2YPkw==/18686200114669622.jpg",
                "trans": "",
                "alias": [],
                "name": "薛之谦",
                "id": 5781,
                "img1v1Id_str": "18686200114669622"
              }
            ],
                "copyrightId": 0,
                "album": {
              "songs": [],
                  "paid": false,
                  "onSale": false,
                  "mark": 0,
                  "awardTags": null,
                  "displayTags": null,
                  "artists": [
                {
                  "img1v1Id": 18686200114669624,
                  "topicPerson": 0,
                  "picId": 0,
                  "briefDesc": "",
                  "musicSize": 0,
                  "albumSize": 0,
                  "followed": false,
                  "picUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg",
                  "img1v1Url": "http://p1.music.126.net/VnZiScyynLG7atLIZ2YPkw==/18686200114669622.jpg",
                  "trans": "",
                  "alias": [],
                  "name": "蒙面唱将猜猜猜",
                  "id": 34307913,
                  "img1v1Id_str": "18686200114669622"
                }
              ],
                  "copyrightId": 0,
                  "picId": 109951163039514700,
                  "artist": {
                "img1v1Id": 18686200114669624,
                    "topicPerson": 0,
                    "picId": 0,
                    "briefDesc": "",
                    "musicSize": 0,
                    "albumSize": 0,
                    "followed": false,
                    "picUrl": "http://p1.music.126.net/6y-UleORITEDbvrOLV0Q8A==/5639395138885805.jpg",
                    "img1v1Url": "http://p1.music.126.net/VnZiScyynLG7atLIZ2YPkw==/18686200114669622.jpg",
                    "trans": "",
                    "alias": [],
                    "name": "",
                    "id": 0,
                    "img1v1Id_str": "18686200114669622"
              },
              "briefDesc": "",
                  "publishTime": 1507996800000,
                  "company": "梦响强音文化传播 (上海) 有限公司",
                  "picUrl": "http://p1.music.126.net/wUwH532yw1k_ij3842KjFA==/109951163039514710.jpg",
                  "commentThreadId": "R_AL_3_36525121",
                  "blurPicUrl": "http://p1.music.126.net/wUwH532yw1k_ij3842KjFA==/109951163039514710.jpg",
                  "companyId": 0,
                  "pic": 109951163039514700,
                  "status": -1,
                  "subType": "现场版",
                  "alias": [],
                  "description": "",
                  "tags": "",
                  "name": "蒙面唱将猜猜猜第二季 第6期",
                  "id": 36525121,
                  "type": "专辑",
                  "size": 10,
                  "picId_str": "109951163039514710"
            },
              "score": 100,
                "hMusic": {
              "volumeDelta": -21870,
                  "playTime": 238476,
                  "bitrate": 320000,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033300,
                  "size": 9541485,
                  "extension": "mp3"
            },
              "mMusic": {
              "volumeDelta": -19266,
                  "playTime": 238476,
                  "bitrate": 192000,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033295,
                  "size": 5724909,
                  "extension": "mp3"
            },
              "lMusic": {
              "volumeDelta": -17576,
                  "playTime": 238476,
                  "bitrate": 128000,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033294,
                  "size": 3816621,
                  "extension": "mp3"
            },
              "audition": null,
                "copyFrom": "",
                "ringtone": null,
                "disc": "01",
                "no": 8,
                "fee": 1,
                "commentThreadId": "R_SO_4_512489621",
                "mvid": 0,
                "rtype": 0,
                "rurl": null,
                "bMusic": {
              "volumeDelta": -17576,
                  "playTime": 238476,
                  "bitrate": 128000,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033294,
                  "size": 3816621,
                  "extension": "mp3"
            },
              "sqMusic": {
              "volumeDelta": -21865,
                  "playTime": 238476,
                  "bitrate": 940700,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033296,
                  "size": 28041889,
                  "extension": "flac"
            },
              "hrMusic": {
              "volumeDelta": -21865,
                  "playTime": 238476,
                  "bitrate": 1710692,
                  "dfsId": 0,
                  "sr": 48000,
                  "name": "",
                  "id": 7492033298,
                  "size": 50995029,
                  "extension": "flac"
            },
              "crbt": null,
                "rtUrl": null,
                "ftype": 0,
                "position": 8,
                "duration": 238476,
                "alias": [],
                "status": 0,
                "name": "遗憾 (Live)",
                "id": 512489621,
                "privilege": {
              "id": 512489621,
                  "fee": 1,
                  "payed": 0,
                  "st": 0,
                  "pl": 0,
                  "dl": 0,
                  "sp": 0,
                  "cp": 0,
                  "subp": 1,
                  "cs": false,
                  "maxbr": 999000,
                  "fl": 0,
                  "toast": false,
                  "flag": 4,
                  "preSell": false,
                  "playMaxbr": 999000,
                  "downloadMaxbr": 999000,
                  "maxBrLevel": "hires",
                  "playMaxBrLevel": "hires",
                  "downloadMaxBrLevel": "hires",
                  "plLevel": "none",
                  "dlLevel": "none",
                  "flLevel": "none",
                  "rscl": null,
                  "freeTrialPrivilege": {
                "resConsumable": true,
                    "userConsumable": false,
                    "listenType": null,
                    "cannotListenReason": null,
                    "playReason": null,
                    "freeLimitTagType": null
              },
              "rightSource": 0,
                  "chargeInfoList": [
                {
                  "rate": 128000,
                  "chargeUrl": null,
                  "chargeMessage": null,
                  "chargeType": 1
                },
                {
                  "rate": 192000,
                  "chargeUrl": null,
                  "chargeMessage": null,
                  "chargeType": 1
                },
                {
                  "rate": 320000,
                  "chargeUrl": null,
                  "chargeMessage": null,
                  "chargeType": 1
                },
                {
                  "rate": 999000,
                  "chargeUrl": null,
                  "chargeMessage": null,
                  "chargeType": 1
                },
                {
                  "rate": 1999000,
                  "chargeUrl": null,
                  "chargeMessage": null,
                  "chargeType": 1
                }
              ],
                  "code": 0,
                  "message": null,
                  "plLevels": null,
                  "dlLevels": null,
                  "ignoreCache": null,
                  "bd": null
            }
            }*/
            const types = [];
            const _types = {};
            let size;
            item.privilege.chargeInfoList.forEach(i => {
                switch (i.rate) {
                    case 128000:
                        size = item.lMusic ? (0, index_2.sizeFormate)(item.lMusic.size) : null;
                        types.push({ type: '128k', size });
                        _types['128k'] = {
                            size,
                        };
                    case 320000:
                        size = item.hMusic ? (0, index_2.sizeFormate)(item.hMusic.size) : null;
                        types.push({ type: '320k', size });
                        _types['320k'] = {
                            size,
                        };
                    case 999000:
                        size = item.sqMusic ? (0, index_2.sizeFormate)(item.sqMusic.size) : null;
                        types.push({ type: 'flac', size });
                        _types.flac = {
                            size,
                        };
                    case 1999000:
                        size = item.hrMusic ? (0, index_2.sizeFormate)(item.hrMusic.size) : null;
                        types.push({ type: 'flac24bit', size });
                        _types.flac24bit = {
                            size,
                        };
                }
            });
            list.push({
                singer: (0, utils_1.formatSingerName)(item.artists),
                name: item.name,
                albumName: item.album.name,
                albumId: item.album.id,
                songmid: item.id,
                source: 'wy',
                interval: (0, index_2.formatPlayTime)(item.duration),
                img: item?.album?.picUrl,
                lrc: null,
                otherSource: null,
                types,
                _types,
                typeUrl: {},
            });
        });
        return list;
    },
    /**
     * 搜索歌手 (type=100 歌手搜索)
     * @param {string} keyword - 搜索关键词
     * @param {number} limit - 返回数量
     */
    searchSinger(keyword, limit = 30) {
        return (0, index_1.eapiRequest)('/api/cloudsearch/pc', {
            s: keyword,
            type: 100,
            limit,
            offset: 0,
            total: true,
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200 || !body.result?.artistCount)
                return null;
            console.log('...searchSinger artists count:', body.result.artists?.length);
            body.result.artists?.forEach((a, index) => {
                console.log(`...searchSinger artist[${index}]:`, JSON.stringify(a, null, 2));
            });
            return body.result.artists.map(a => ({
                id: a?.id,
                name: a?.name,
                avatar: a?.picUrl,
                avatarRaw: a?.img1v1Url, // 原图 URL
                musicCount: a?.musicSize,
                albumCount: a?.albumSize,
            })).filter(a => a.id);
        });
    },
};
