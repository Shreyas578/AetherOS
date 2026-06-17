import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { analyzeSentiment } from '../../skills/sentiment/index';
import { reason } from '../../skills/llm-reasoning/index';
import { getRecentPosts, createPost, tipPost } from '../../skills/social/index';
import { computeReputation } from '../../skills/reputation/index';
import { createLogger } from '../../skills/shared/index';
import axios from 'axios';

const logger = createLogger('social-agent');
const prisma = new PrismaClient();
const INTERVAL_MS = parseInt(process.env.SOCIAL_AGENT_INTERVAL_MS || '900000');
const TIP_THRESHOLD = 60; // content score >= 60 gets a tip
const TIP_AMOUNT_PHRS = '0.001';

async function runSocialCycle() {
  logger.info('=== Social Agent Cycle Start ===');
  const agent = await prisma.agent.findFirst({ where: { type: 'SOCIAL' } });
  if (!agent) return;
  const cycleStart = Date.now();

  try {
    // 1. Fetch recent social posts
    const posts = await getRecentPosts(20);
    logger.info(`Fetched ${posts.length} recent posts`);

    const scoredPosts: Array<{ post: typeof posts[0]; score: number; shouldTip: boolean; commentary: string }> = [];

    // 2. Score each post
    for (const post of posts) {
      // Fetch IPFS content if available
      let content = post.ipfsUri;
      try {
        const ipfsResp = await axios.get(post.ipfsUri, { timeout: 5000 });
        content = typeof ipfsResp.data === 'object'
          ? (ipfsResp.data.content || JSON.stringify(ipfsResp.data))
          : String(ipfsResp.data);
      } catch { /* use URI as content fallback */ }

      const sentiment = await analyzeSentiment(content.slice(0, 500));
      const authorRep = await computeReputation(post.author);

      const scoring = await reason<{ score: number; shouldTip: boolean; tipAmountPhrs: string; commentary: string }>(
        `You are AetherOS Social Agent analyzing on-chain content quality.
Post content: "${content.slice(0, 300)}"
Author reputation: ${authorRep.score}/100
Sentiment: ${sentiment.label} (${sentiment.score.toFixed(2)})
Tip amount already received: ${post.tipAmount} PHRS

Rate this content and decide if it deserves a tip.
Respond with JSON only:
{"score":0-100,"shouldTip":true|false,"tipAmountPhrs":"0.001","commentary":"1 sentence"}`,
        { score: 'number', shouldTip: 'boolean', tipAmountPhrs: 'string', commentary: 'string' }
      );

      scoredPosts.push({
        post,
        score: scoring.data.score ?? 0,
        shouldTip: (scoring.data.score ?? 0) >= TIP_THRESHOLD,
        commentary: scoring.data.commentary || '',
      });
    }

    // 3. Tip top content
    const toTip = scoredPosts.filter(s => s.shouldTip).slice(0, 3); // tip top 3
    for (const { post, score, commentary } of toTip) {
      try {
        const tipResult = await tipPost(post.id, TIP_AMOUNT_PHRS, { walletIndex: agent.wallet_index });
        logger.info('Tipped post', { postId: post.id, score, txHash: tipResult.txHash });
      } catch (err) {
        logger.warn('Tip failed', { postId: post.id, error: String(err) });
      }
    }

    // 4. Generate commentary post via llm-reasoning
    const topPost = scoredPosts.sort((a, b) => b.score - a.score)[0];
    if (topPost) {
      const commentResult = await reason<{ commentary: string }>(
        `You are AetherOS, an AI agent on the Pharos blockchain. Generate an insightful 2-3 sentence commentary about the current state of on-chain social activity.
Top post score: ${topPost.score}/100
Recent activity: ${scoredPosts.length} posts analyzed, ${toTip.length} tipped
Key observation: ${topPost.commentary}

Respond with JSON: {"commentary": "your 2-3 sentence social commentary"}`,
        { commentary: 'string' }
      );

      if (commentResult.data.commentary) {
        try {
          const postResult = await createPost(
            commentResult.data.commentary,
            { agent: 'AetherOS-Social', cycle: Date.now(), topScore: topPost.score },
            { walletIndex: agent.wallet_index }
          );
          logger.info('Commentary posted', { postId: postResult.postId });
        } catch (err) {
          logger.warn('Failed to post commentary', { error: String(err) });
        }
      }
    }

    // 5. Log event
    await prisma.agentEvent.create({
      data: {
        agent_id: agent.id,
        event_type: 'SOCIAL_CYCLE',
        inputs_json: { postsAnalyzed: posts.length },
        reasoning_text: [
          `Analyzed ${posts.length} posts`,
          `Tipped ${toTip.length} posts (threshold: ${TIP_THRESHOLD})`,
          `Top post score: ${topPost?.score || 0}`,
        ].join('\n'),
        output_json: { tipped: toTip.map(t => t.post.id), scores: scoredPosts.map(s => ({ id: s.post.id, score: s.score })) },
        inference_latency_ms: Date.now() - cycleStart,
        success: true,
      },
    });
  } catch (err) {
    logger.error('Social cycle error', { error: String(err) });
  }
}

async function main() {
  logger.info('Social Agent starting...', { interval: INTERVAL_MS });
  await runSocialCycle();
  setInterval(runSocialCycle, INTERVAL_MS);
}

main().catch(err => { logger.error('Fatal', { err }); process.exit(1); });
