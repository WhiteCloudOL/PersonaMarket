import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  personas,
  personaReleases,
  releaseSubmissions,
  type Database,
} from '@personamarket/database';
import { PublicFacetsResponseSchema } from '@personamarket/contracts';
import { DATABASE } from '../tokens.js';
import { publicCurrentCondition } from './public-visibility.js';
@Injectable()
export class FacetsRepository {
  constructor(@Inject(DATABASE) readonly database: Database) {}
  async read() {
    // 单一语句的可见快照：计数、模型和标签均不读取草稿或待审正文。
    const result = await this.database.db.execute(sql`WITH visible AS (
      SELECT ${personas.id} AS id, ${personas.platform} AS platform, ${releaseSubmissions.snapshot} AS snapshot
      FROM ${personas} JOIN ${personaReleases} ON ${personas.publishedReleaseId}=${personaReleases.id} AND ${personas.id}=${personaReleases.personaId}
      JOIN ${releaseSubmissions} ON ${releaseSubmissions.id}=${personaReleases.approvedSubmissionId}
      WHERE ${publicCurrentCondition}
    ) SELECT jsonb_build_object(
      'categories', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',options.id,'name',options.name,'count',options.count) ORDER BY options.sort_order,options.name,options.id), '[]'::jsonb) FROM (SELECT c.id,c.name,c.sort_order,count(v.id)::integer AS count FROM categories c LEFT JOIN visible v ON c.id::text=v.snapshot->>'categoryId' WHERE c.active GROUP BY c.id ORDER BY c.sort_order,c.name,c.id LIMIT 100) options),
      'tags', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',options.id,'name',options.name,'count',options.count) ORDER BY options.sort_order,options.name,options.id), '[]'::jsonb) FROM (SELECT t.id,t.name,t.sort_order,COALESCE(tag_counts.count,0)::integer AS count FROM tags t LEFT JOIN (SELECT item.id,count(DISTINCT v.id)::integer AS count FROM visible v CROSS JOIN LATERAL jsonb_array_elements_text(v.snapshot->'tagIds') item(id) GROUP BY item.id) tag_counts ON tag_counts.id=t.id::text WHERE t.active ORDER BY t.sort_order,t.name,t.id LIMIT 100) options),
      'models', (SELECT COALESCE(jsonb_agg(to_jsonb(options)), '[]'::jsonb) FROM (SELECT model->>'modelId' AS value,model->>'modelId' AS label,count(DISTINCT v.id)::integer AS count FROM visible v CROSS JOIN LATERAL jsonb_array_elements(v.snapshot->'recommendedModels') model GROUP BY model->>'modelId' ORDER BY count DESC,value LIMIT 100) options),
      'platforms', jsonb_build_object('maibot',(SELECT count(*)::integer FROM visible WHERE platform='maibot'),'astrbot',(SELECT count(*)::integer FROM visible WHERE platform='astrbot')),
      'origins', (SELECT jsonb_agg(jsonb_build_object('value',o.value,'label',o.label,'count',(SELECT count(*)::integer FROM visible v WHERE v.snapshot->'origin'->>'type'=o.value))) FROM (VALUES ('original','原创作品'),('repost','转载作品')) o(value,label)),
      'policies', (SELECT jsonb_agg(jsonb_build_object('value',o.value,'label',o.label,'count',(SELECT count(*)::integer FROM visible v WHERE v.snapshot->'origin'->>'redistribution'=o.value))) FROM (VALUES ('not_allowed','不允许转载'),('attribution_required','注明出处'),('contact_required','联系作者'),('custom','自定义规则')) o(value,label))
    ) AS data`);
    return PublicFacetsResponseSchema.parse({ data: result.rows[0]?.['data'] });
  }
}
