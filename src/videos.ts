/**
 * 视频生成模块 - Seedance 2.0 / 1.5
 * 基于与图像生成相同的 draft_content 架构，使用 video_base_component
 */

import { request, parseRegionFromToken, getAssistantId } from './api';
import {
  VIDEO_MODEL_MAP,
  VIDEO_MODEL_MAP_CN,
  DEFAULT_VIDEO_MODEL,
  VIDEO_ASPECT_RATIO_MAP,
  DRAFT_VERSION,
  DRAFT_MIN_VERSION,
  RegionInfo,
} from './consts';
import { uuid } from './utils';

/**
 * 视频任务状态
 */
export interface VideoTaskStatus {
  taskId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  videoUrl?: string;
  coverUrl?: string;
  duration?: number;
  error?: string;
  createdAt: number;
}

/**
 * 获取视频模型 key
 */
function getVideoModel(model: string, regionInfo: RegionInfo): string {
  const modelMap = regionInfo.isCN ? VIDEO_MODEL_MAP_CN : VIDEO_MODEL_MAP;
  const resolved = modelMap[model] ?? modelMap[DEFAULT_VIDEO_MODEL];
  console.log(`视频模型: ${model} -> ${resolved}`);
  return resolved;
}

/**
 * 解析视频比例 code
 */
function resolveVideoRatio(ratio: string): number {
  return VIDEO_ASPECT_RATIO_MAP[ratio] ?? VIDEO_ASPECT_RATIO_MAP["16:9"];
}

/**
 * 构建视频 draft_content
 */
function buildVideoDraftContent(options: {
  componentId: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  duration: number;
  ratio: string;
  ratioCode: number;
  referenceImageUri?: string;
}): string {
  const {
    componentId,
    model,
    prompt,
    negativePrompt,
    seed,
    duration,
    ratio,
    ratioCode,
    referenceImageUri,
  } = options;

  const coreParam: any = {
    type: "",
    id: uuid(),
    model,
    prompt,
    seed,
    duration,
    aspect_ratio: ratio,
    video_ratio: ratioCode,
  };

  if (negativePrompt) {
    coreParam.negative_prompt = negativePrompt;
  }

  // 如果有参考图，加入 reference_image_list
  if (referenceImageUri) {
    coreParam.reference_image_list = [
      {
        type: "image",
        id: uuid(),
        source_from: "upload",
        platform_type: 1,
        image_uri: referenceImageUri,
        width: 0,
        height: 0,
      },
    ];
  }

  const component: any = {
    type: "video_base_component",
    id: componentId,
    min_version: DRAFT_MIN_VERSION,
    aigc_mode: "workbench",
    metadata: {
      type: "",
      id: uuid(),
      created_platform: 3,
      created_platform_version: "",
      created_time_in_ms: Date.now().toString(),
      created_did: "",
    },
    generate_type: "generate",
    abilities: {
      type: "",
      id: uuid(),
      generate: {
        type: "",
        id: uuid(),
        core_param: coreParam,
      },
      gen_option: {
        type: "",
        id: uuid(),
        generate_all: false,
      },
    },
  };

  const draft = {
    type: "draft",
    id: uuid(),
    min_version: DRAFT_MIN_VERSION,
    min_features: [],
    is_from_tsn: true,
    version: DRAFT_VERSION,
    main_component_id: componentId,
    component_list: [component],
  };

  return JSON.stringify(draft);
}

/**
 * 构建视频 metrics_extra
 */
function buildVideoMetricsExtra(options: {
  model: string;
  submitId: string;
  duration: number;
  ratio: string;
  regionInfo: RegionInfo;
}): string {
  const { model, submitId, duration, ratio, regionInfo } = options;

  const sceneOption: any = {
    type: "video",
    scene: "VideoBasicGenerate",
    modelReqKey: model,
    duration,
    aspectRatio: ratio,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: `${model}-${duration}s`,
      useVipFunctionDetailsReporterHoc: true,
    },
  };

  if (!regionInfo.isCN) {
    sceneOption.benefitCount = 1;
  }

  return JSON.stringify({
    promptSource: "custom",
    generateCount: 1,
    enterFrom: "click",
    sceneOptions: JSON.stringify([sceneOption]),
    generateId: submitId,
    isRegenerate: false,
  });
}

/**
 * 提交视频生成任务（异步）
 */
export async function submitVideoTask(
  _model: string,
  prompt: string,
  options: {
    ratio?: string;
    duration?: number;
    negativePrompt?: string;
    referenceImageUri?: string;
  },
  refreshToken: string
): Promise<{ taskId: string; submitId: string }> {
  const {
    ratio = "16:9",
    duration = 8,
    negativePrompt = "",
    referenceImageUri,
  } = options;

  const regionInfo = parseRegionFromToken(refreshToken);
  console.log(`[Video] 区域: ${regionInfo.region}`);

  const model = getVideoModel(_model, regionInfo);
  const ratioCode = resolveVideoRatio(ratio);
  const componentId = uuid();
  const submitId = uuid();
  const seed = Math.floor(Math.random() * 100000000) + 2500000000;

  const draftContent = buildVideoDraftContent({
    componentId,
    model,
    prompt,
    negativePrompt: negativePrompt || undefined,
    seed,
    duration,
    ratio,
    ratioCode,
    referenceImageUri,
  });

  const metricsExtra = buildVideoMetricsExtra({
    model,
    submitId,
    duration,
    ratio,
    regionInfo,
  });

  const requestData = {
    extend: {
      root_model: model,
    },
    submit_id: submitId,
    metrics_extra: metricsExtra,
    draft_content: draftContent,
    http_common_info: {
      aid: getAssistantId(regionInfo),
    },
  };

  console.log(`[Video] 提交生成请求... 模型=${model}, 时长=${duration}s, 比例=${ratio}`);

  const result = await request("post", "/mweb/v1/aigc_draft/generate", refreshToken, {
    data: requestData,
  });

  const historyId = result?.aigc_data?.history_record_id;
  if (!historyId) {
    console.error(`[Video] 生成响应: ${JSON.stringify(result)}`);
    throw new Error("视频任务ID不存在");
  }

  console.log(`[Video] 任务已提交，task_id: ${historyId}, submit_id: ${submitId}`);

  return { taskId: historyId, submitId };
}

/**
 * 查询视频任务状态
 */
export async function getVideoTaskStatus(
  taskId: string,
  refreshToken: string
): Promise<VideoTaskStatus> {
  try {
    const result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [taskId],
      },
    });

    if (!result[taskId]) {
      return {
        taskId,
        status: 'failed',
        error: '任务不存在',
        createdAt: Date.now(),
      };
    }

    const taskInfo = result[taskId];
    const status = taskInfo.status;
    const failCode = taskInfo.fail_code;
    const itemList: any[] = taskInfo.item_list || [];

    // 提取视频 URL（视频 item 结构与图片不同）
    const videoItem = itemList.find((item: any) =>
      item?.video?.video_url || item?.video_url || item?.common_attr?.video_url
    );

    let videoUrl: string | undefined;
    let coverUrl: string | undefined;
    let duration: number | undefined;

    if (videoItem) {
      videoUrl =
        videoItem?.video?.video_url ||
        videoItem?.video_url ||
        videoItem?.common_attr?.video_url;
      coverUrl =
        videoItem?.video?.cover_url ||
        videoItem?.cover_url ||
        videoItem?.common_attr?.cover_url;
      duration =
        videoItem?.video?.duration ||
        videoItem?.duration;
    }

    // status codes: 10=SUCCESS, 20=PROCESSING, 30=FAILED, 50=COMPLETED
    if (status === 10 || status === 50) {
      return {
        taskId,
        status: 'completed',
        progress: 100,
        videoUrl,
        coverUrl,
        duration,
        createdAt: Date.now(),
      };
    }

    if (status === 30) {
      let errorMsg = `生成失败，错误代码: ${failCode}`;
      if (failCode === '2038') errorMsg = '内容由于合规问题已被阻止生成';
      return {
        taskId,
        status: 'failed',
        error: errorMsg,
        createdAt: Date.now(),
      };
    }

    // 进行中
    const progress = status === 20 ? 50 : 10;
    return {
      taskId,
      status: videoUrl ? 'processing' : 'pending',
      progress,
      videoUrl,
      coverUrl,
      createdAt: Date.now(),
    };

  } catch (error: any) {
    console.error(`[Video] 查询任务状态失败: ${error.message}`);
    return {
      taskId,
      status: 'failed',
      error: error.message,
      createdAt: Date.now(),
    };
  }
}
