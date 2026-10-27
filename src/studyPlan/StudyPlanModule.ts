/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/studyPlan/StudyPlanModule.ts
 * Path: https://github.com/ccagml/leetcode-extension
 *
 * 在线获取力扣学习计划(如 top-100-liked)的分组和题目, 获取失败时由调用方回退到内置题单
 */

import { BABAMediator, BABAProxy, BabaStr, BaseCC, BABA } from "../BABA";

export interface IStudyPlanGroup {
  name: string;
  questions: string[]; // 题目编号 fid, 按学习计划顺序
}

export interface IStudyPlan {
  slug: string;
  name: string;
  groups: IStudyPlanGroup[];
}

class StudyPlanData {
  // 正在请求或已获取的学习计划, 失败的不缓存, 下次展开时重试
  planInfo: Map<string, Promise<IStudyPlan | undefined>> = new Map<string, Promise<IStudyPlan | undefined>>();

  clear() {
    this.planInfo.clear();
  }
}

const studyPlanData: StudyPlanData = new StudyPlanData();

export class StudyPlanProxy extends BABAProxy {
  static NAME = BabaStr.StudyPlanProxy;
  constructor() {
    super(StudyPlanProxy.NAME);
  }

  public getStudyPlan(planSlug: string): Promise<IStudyPlan | undefined> {
    let plan = studyPlanData.planInfo.get(planSlug);
    if (!plan) {
      plan = this.searchStudyPlan(planSlug);
      studyPlanData.planInfo.set(planSlug, plan);
      plan.then((result) => {
        if (!result) {
          studyPlanData.planInfo.delete(planSlug);
        }
      });
    }
    return plan;
  }

  private async searchStudyPlan(planSlug: string): Promise<IStudyPlan | undefined> {
    try {
      const result: string = await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().getStudyPlan(planSlug);
      const query_result = JSON.parse(result);
      if (query_result.code != 100) {
        BABA.getProxy(BabaStr.LogOutputProxy)
          .get_log()
          .appendLine(`获取学习计划 ${planSlug} 失败, 使用内置题单: ${query_result.msg}`);
        return undefined;
      }
      const plan: IStudyPlan = query_result.data;
      const questionCount = plan.groups.reduce((sum, group) => sum + group.questions.length, 0);
      // 尊享题单等未解锁时接口返回空分组, 视为获取失败
      return questionCount > 0 ? plan : undefined;
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy)
        .get_log()
        .appendLine(`获取学习计划 ${planSlug} 失败, 使用内置题单: ${error}`);
      return undefined;
    }
  }
}

export class StudyPlanMediator extends BABAMediator {
  static NAME = BabaStr.StudyPlanMediator;
  constructor() {
    super(StudyPlanMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [BabaStr.BABACMD_refresh, BabaStr.TreeData_switchEndpoint];
  }
  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    switch (_notification.getName()) {
      case BabaStr.BABACMD_refresh:
      case BabaStr.TreeData_switchEndpoint:
        studyPlanData.clear();
        break;
      default:
        break;
    }
  }
}
