import { randomUUID } from 'node:crypto';
import type { Post, Publisher, PublishedPost } from '@ripple/shared';

// Stands in for Instagram when the real account is unavailable. Posts are kept in memory and served by the console.
export class SimulatedPublisher implements Publisher {
  readonly simulated = true;
  readonly posts: Array<Post & PublishedPost> = [];

  async publish(post: Post): Promise<PublishedPost> {
    const id = randomUUID();
    const published = { id, url: `/simulated-posts/${id}`, simulated: true };
    this.posts.push({ ...post, ...published });
    return published;
  }
}
