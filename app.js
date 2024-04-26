const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const app = express()
app.use(express.json())

const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null

const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server running at localhost:3000')
    })
  } catch (error) {
    console.log(`DB Error: ${error.message}`)
    process.exit(1)
  }
}

initializeDBandServer()

const authenticateUser = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'SECRET_KEY', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        next()
      }
    })
  }
}

//Register User
app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}'`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser !== undefined) {
    response.status(400)
    response.send('User already exists')
  } else {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const registerUserQuery = `
                INSERT INTO
                  user (name, username, password, gender)
                VALUES (
                    '${name}',
                    '${username}',
                    '${hashedPassword}',
                    '${gender}'
                )
            `
      await db.run(registerUserQuery)
      response.send('User created successfully')
    }
  }
})

//Login User
app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `
  SELECT 
    * 
  FROM 
    user 
  WHERE 
    username = '${username}';`
  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatched === true) {
      const payload = {username: username}
      const jwtToken = jwt.sign(payload, 'SECRET_KEY')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

//Get User Following tweets
app.get('/user/tweets/feed/', authenticateUser, async (request, response) => {
  const {username} = request
  const limit = 4

  const getUser = `SELECT * FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUser)

  const getFollowingTweetsQuery = `
  SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
  FROM tweet
    INNER JOIN user ON tweet.user_id = user.user_id
  WHERE tweet.user_id IN (
    SELECT following_user_id 
    FROM follower 
    WHERE follower_user_id = ${loginUser.user_id}
  )
  ORDER BY tweet.date_time DESC
  LIMIT ${limit};
  `
  const userFollowingTweets = await db.all(getFollowingTweetsQuery)

  response.send(userFollowingTweets)
})

//Get Following of Logged User
app.get('/user/following/', authenticateUser, async (request, response) => {
  let {username} = request

  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUser)

  const getFollowingQuery = `
  SELECT
    name
  FROM user AS u
    INNER JOIN follower AS f
    ON u.user_id = f.following_user_id
  WHERE f.follower_user_id = ${loginUser.user_id};
  `
  const userFollowing = await db.all(getFollowingQuery)

  response.send(userFollowing)
})

//Get Followers
app.get('/user/followers/', authenticateUser, async (request, response) => {
  let {username} = request

  const getUser = `SELECT user_id FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUser)

  const getFollowersQuery = `
  SELECT name
  FROM follower
  INNER JOIN user ON follower.follower_user_id = user.user_id
  WHERE following_user_id = ${loginUser.user_id}
  `
  const userFollowers = await db.all(getFollowersQuery)

  response.send(userFollowers)
})

//Get tweets of User Following
app.get('/tweets/:tweetId/', authenticateUser, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params

  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUserQuery)
  console.log(loginUser)
  const getTweetsOwnerQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`
  const tweetOwner = await db.get(getTweetsOwnerQuery)
  console.log(tweetOwner)
  const isFollowingQuery = `
  SELECT * 
  FROM follower
  WHERE follower_user_id = ${loginUser.user_id}`
  const followingQuery = await db.all(isFollowingQuery)
  const noOfFollowings = followingQuery.length
  console.log(followingQuery)
  if (noOfFollowings === 0) {
    response.status(401)
    response.send('Invalid Request')
  } else if (noOfFollowings === 1) {
    const followingUserId = followingQuery.following_user_id
    if (followingUserId != tweetOwner.user_id) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const getTweetsQuery = `
        SELECT tweet, 
          COUNT(distinct like_id) AS likes,
          COUNT(distinct reply_id) AS replies,
          date_time AS dateTime
        FROM tweet
          INNER JOIN like ON tweet.tweet_id = like.tweet_id
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.user_id = ${followingUserId}
        AND tweet.tweet_id = ${tweetId}
      `
      const tweet = await db.all(getTweetsQuery)
      response.send(tweet)
    }
  } else {
    let tweetsArrayofFollowing = []
    for (const followingUser of followingQuery) {
      const follwingUserId = followingUser.following_user_id
      if (follwingUserId != tweetOwner.user_id) {
        continue
      } else {
        const tweetQuery = `
        SELECT tweet.tweet, 
          COUNT(distinct like_id) AS likes,
          COUNT(distinct reply_id) AS replies,
          date_time AS dateTime
        FROM tweet
          INNER JOIN like ON tweet.tweet_id = like.tweet_id
          INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.user_id = ${follwingUserId}
          AND tweet.tweet_id = ${tweetId}
        `
        const tweets = await db.get(tweetQuery)
        tweetsArrayofFollowing.push(tweets)
      }
    }
    if (tweetsArrayofFollowing.length === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else if (tweetsArrayofFollowing.length === 1) {
      response.send(tweetsArrayofFollowing[0])
    } else {
      response.send(tweetsArrayofFollowing)
    }
  }
})

//Get Likes of tweets of User Following
app.get(
  '/tweets/:tweetId/likes/',
  authenticateUser,
  async (request, response) => {
    let {username} = request
    const {tweetId} = request.params

    const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
    const loginUser = await db.get(getUserQuery)

    const getTweetsOwnerQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`
    const tweetOwner = await db.get(getTweetsOwnerQuery)

    const isFollowingQuery = `
    SELECT * 
    FROM follower
    WHERE follower_user_id = ${loginUser.user_id}
    `
    const followingQuery = await db.all(isFollowingQuery)
    const noOfFollowing = followingQuery.length

    if (noOfFollowing === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const followingUserIds = followingQuery.map(
        user => user.following_user_id,
      )

      if (!followingUserIds.includes(tweetOwner.user_id)) {
        response.status(401).send('Invalid Request')
        return
      }
      const getLikesQuery = `
      SELECT user.username
      FROM like
        INNER JOIN user ON like.user_id = user.user_id
        WHERE like.tweet_id = ${tweetId};
      `
      const likedUsers = await db.all(getLikesQuery)

      if (likedUsers.length === 0) {
        response.status(404).send('No likes found for this tweet')
        return
      }
      const likes = likedUsers.map(user => user.username)
      response.send({likes})
    }
  },
)

//Get Replies of tweets of User Following
app.get(
  '/tweets/:tweetId/replies/',
  authenticateUser,
  async (request, response) => {
    let {username} = request
    const {tweetId} = request.params

    const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
    const loginUser = await db.get(getUserQuery)

    const getTweetsOwnerQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`
    const tweetOwner = await db.get(getTweetsOwnerQuery)

    const isFollowingQuery = `
    SELECT * 
    FROM follower
    WHERE follower_user_id = ${loginUser.user_id}
    `
    const followingQuery = await db.all(isFollowingQuery)
    const noOfFollowing = followingQuery.length

    if (noOfFollowing === 0) {
      response.status(401)
      response.send('Invalid Request')
    } else if (noOfFollowing === 1) {
      const followingUserId = followingQuery.following_user_id
      if (followingUserId != tweetOwner.user_id) {
        response.status(401)
        response.send('Invalid Request')
      } else {
        const getRepliesQuery = `
        SELECT name, reply
        FROM reply
          INNER JOIN user ON reply.user_id = user.user_id
        WHERE reply.tweet_id = ${tweetId};
        `
        const repliedUsers = await db.all(getRepliesQuery)
        response.send({likes: repliedUsers.map(user => user.name)})
      }
    } else {
      let repliesArrayofFollowing = []
      for (const followingUser of followingQuery) {
        const followingUserId = followingUser.following_user_id
        if (followingUserId != tweetOwner.user_id) {
          continue
        } else {
          const getRepliesQuery = `
          SELECT name, reply
          FROM reply
            INNER JOIN user ON reply.user_id = user.user_id
          WHERE reply.tweet_id = ${tweetId};
          `
          const repliedUsers = await db.all(getRepliesQuery)
          repliesArrayofFollowing.push(repliedUsers)
        }
      }
      if (repliesArrayofFollowing.length === 0) {
        response.status(401)
        response.send('Invalid Request')
      } else if (repliesArrayofFollowing[0].length === 1) {
        response.send({
          replies: repliesArrayofFollowing[0].map(user => ({
            name: user.name,
            reply: user.reply,
          })),
        })
      } else {
        response.send({
          replies: repliesArrayofFollowing[0].map(user => ({
            name: user.name,
            reply: user.reply,
          })),
        })
      }
    }
  },
)

//Get Tweets of logged User
app.get('/user/tweets/', authenticateUser, async (request, response) => {
  let {username} = request
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUserQuery)

  const getTweetsQuery = `
  SELECT 
  tweet,
  COUNT(distinct like.like_id) AS likes,
  COUNT(distinct reply.reply_id) AS replies,
  tweet.date_time AS dateTime
  FROM tweet
  INNER JOIN like ON tweet.tweet_id = like.tweet_id
  INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
  WHERE tweet.user_id = ${loginUser.user_id}
  GROUP BY tweet.tweet_id
  `
  const tweets = await db.all(getTweetsQuery)
  response.send(tweets)
})

//Create tweet
app.post('/user/tweets/', authenticateUser, async (request, response) => {
  const {username} = request
  const {tweet} = request.body
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUserQuery)

  const addTweetQuery = `
  INSERT INTO 
  tweet (tweet, user_id)
  VALUES (
    '${tweet}',
    ${loginUser.user_id}
  )
  `
  await db.get(addTweetQuery)
  response.send('Created a Tweet')
})

//Delete tweet
app.delete('/tweets/:tweetId/', authenticateUser, async (request, response) => {
  const {username} = request
  const {tweetId} = request.params
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`
  const loginUser = await db.get(getUserQuery)

  if (!loginUser) {
    response.status(401)
    response.send('Invalid Request')
  }

  const getTweetsOwnerQuery = `SELECT * FROM tweet WHERE tweet_id = ${tweetId}`
  const tweetOwner = await db.get(getTweetsOwnerQuery)

  if (!tweetOwner || tweetOwner.user_id !== loginUser.user_id) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteTweetQuery = `
    DELETE FROM tweet 
    WHERE tweet_id = ${tweetId};
    `
    await db.run(deleteTweetQuery)
    response.send('Tweet Removed')
  }
})

module.exports = app
