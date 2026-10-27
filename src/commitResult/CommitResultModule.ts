/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/SubmissionService.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import { ViewColumn, commands } from "vscode";
import { BaseWebViewService } from "../service/BaseWebviewService";
import { markdownService } from "../service/MarkdownService";
import { ISubmitEvent, ITestSolutionData } from "../model/ConstDefind";
import { IWebViewOption } from "../model/ConstDefind";
import { promptHintMessage } from "../utils/OutputUtils";
import { isAnswerDiffColor } from "../utils/ConfigUtils";
import { BABA, BABAMediator, BABAProxy, BabaStr, BaseCC } from "../BABA";

class SubmissionService extends BaseWebViewService {
  protected readonly viewType: string = "leetcode.submission";
  private result: IResult;

  private tempTestCase: Map<string, ITestSolutionData> = new Map<string, ITestSolutionData>();

  public getTSDByQid(qid: string): ITestSolutionData | undefined {
    return this.tempTestCase.get(qid);
  }

  public show(resultString: string, tsd?: ITestSolutionData): void {
    this.result = this.parseResult(resultString);

    const temp = this.getSubmitEvent();
    let costTime = BABA.getProxy(BabaStr.StatusBarTimeProxy).getCostTimeStr();
    if (temp?.accepted && temp?.sub_type == "submit" && costTime) {
      this.result["costTime"] = [`耗时 ${costTime}`];
    }
    this.showWebviewInternal();
    this.showKeybindingsHint();

    let submit_event: ISubmitEvent = this.getSubmitEvent();
    if (tsd != undefined) {
      let qid = submit_event?.qid?.toString();
      this.tempTestCase.set(qid, tsd);
    }
    BABA.sendNotification(BabaStr.CommitResult_showFinish, submit_event);
  }
  public getSubmitEvent(): ISubmitEvent {
    return this.result.system_message as unknown as ISubmitEvent;
  }

  protected getWebviewOption(): IWebViewOption {
    return {
      title: "Submission",
      viewColumn: ViewColumn.Two,
    };
  }

  private sections_filtter(key) {
    if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
      return false;
    } else if (key.substring(0, 8) == "Expected") {
      return false;
    } else if (key == "messages") {
      return false;
    } else if (key == "system_message") {
      return false;
    } else if (key == "costTime") {
      return false;
    }
    return true;
  }
  private getAnswerKey(result) {
    let ans;
    let exp;
    for (const key in result) {
      if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
        ans = key;
      } else if (key.substring(0, 8) == "Expected") {
        exp = key;
      }
      if (ans != undefined && exp != undefined) {
        break;
      }
    }
    let key: Array<any> = [];
    key.push(ans);
    key.push(exp);
    return key;
  }

  // 每个用例是否通过: 优先用力扣返回的 compare_result, 长度对不上时按输出和预期是否相同判断
  private getCaseResults(ans: string[], exp: string[]): boolean[] {
    const compare_result = this.getSubmitEvent()?.compare_result || "";
    const caseCount = Math.max(ans.length, exp.length);
    const res: boolean[] = [];
    for (let index = 0; index < caseCount; index++) {
      res.push(compare_result.length == caseCount ? compare_result[index] == "1" : ans[index] === exp[index]);
    }
    return res;
  }

  // 测试输入是所有用例的参数按行拼接, 行数能整除用例数时按用例切分
  private getCaseInputs(caseCount: number): string[] | undefined {
    const input = this.result["Your Input"];
    if (!input || caseCount == 0) {
      return undefined;
    }
    const lines = input.join("\n").split("\n");
    if (lines.length % caseCount != 0) {
      return undefined;
    }
    const paramCount = lines.length / caseCount;
    const res: string[] = [];
    for (let index = 0; index < caseCount; index++) {
      res.push(lines.slice(index * paramCount, (index + 1) * paramCount).join(", "));
    }
    return res;
  }

  private getTitle(caseResults: boolean[] | undefined): string {
    const message = this.result.messages[0];
    const submitEvent = this.getSubmitEvent();
    if (caseResults && caseResults.length > 0 && message == "Finished") {
      const passed = caseResults.filter((x) => x).length;
      return passed == caseResults.length
        ? `## ✅ 全部通过 ${passed}/${caseResults.length}`
        : `## ❌ 未通过 ${passed}/${caseResults.length}`;
    }
    if (submitEvent?.sub_type == "submit" || message != "Finished") {
      return `## ${submitEvent?.accepted ? "✅" : "❌"} ${message}`;
    }
    return `## ${message}`;
  }

  protected getWebviewContent(): string {
    const styles: string = markdownService.getStyles(this.panel);
    if (this.result?.costTime && this.result?.costTime.length > 0) {
      this.result.messages.push(this.result?.costTime[0]);
    }
    const messages: string[] = this.result.messages.slice(1).map((m: string) => `* ${m}`);

    let ans_key: Array<any> = this.getAnswerKey(this.result);
    let caseResults: boolean[] | undefined;
    let ans: string[] = [];
    let exp: string[] = [];
    if (ans_key[0] != undefined && ans_key[1] != undefined) {
      // 输出末尾带一个空行, 不算用例
      ans = trimTailEmpty(this.result[ans_key[0]]);
      exp = trimTailEmpty(this.result[ans_key[1]]);
      caseResults = this.getCaseResults(ans, exp);
    }
    const title: string = this.getTitle(caseResults);

    let sections: string[] = [];
    if (isAnswerDiffColor()) {
      const caseInputs = caseResults ? this.getCaseInputs(caseResults.length) : undefined;
      sections = Object.keys(this.result)
        .filter(this.sections_filtter)
        .filter((key: string) => !(caseInputs && key == "Your Input"))
        .filter((key: string) => !(key == "Stdout" && this.result[key].join("").trim() == ""))
        .map((key: string) => [`### ${key}`, "```", this.result[key].join("\n"), "```"].join("\n"));

      if (caseResults) {
        const outputName = ans_key[0].replace(/^(Output|Answer)/, "输出");
        sections.push(`### 用例\n`);
        sections.push(`| # | 结果 | ${caseInputs ? "输入 | " : ""}${outputName} | 预期 |`);
        sections.push(`| :-: | :-: | ${caseInputs ? ":-- | " : ""}:-- | :-- |`);
        caseResults.forEach((pass, index) => {
          const input = caseInputs ? `${escapeCell(caseInputs[index])} | ` : "";
          sections.push(
            `| ${index + 1} | ${pass ? "✅" : "❌"} | ${input}${escapeCell(ans[index] || "")} | ${escapeCell(exp[index] || "")} |`
          );
        });
      }
    } else {
      sections = Object.keys(this.result)
        .filter((key: string) => key !== "messages" && key !== "system_message")
        .map((key: string) => [`### ${key}`, "```", this.result[key].join("\n"), "```"].join("\n"));
    }
    let body: string = markdownService.render([title, ...messages, ...sections].join("\n"));

    let aaa = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource:; style-src vscode-resource:;"/>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${styles}
    </head>
    <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
        ${body}
    </body>
    </html>
`;
    return aaa;
  }

  protected onDidDisposeWebview(): void {
    super.onDidDisposeWebview();
  }

  private async showKeybindingsHint(): Promise<void> {
    let that = this;
    await promptHintMessage(
      "hint.commandShortcut",
      'You can customize shortcut key bindings in File > Preferences > Keyboard Shortcuts with query "leetcode".',
      "Open Keybindings",
      (): Promise<any> => that.openKeybindingsEditor("leetcode solution")
    );
  }

  private async openKeybindingsEditor(query?: string): Promise<void> {
    await commands.executeCommand("workbench.action.openGlobalKeybindings", query);
  }

  private add_color_str(str1, str2) {
    let result: Array<string> = [];
    let min_len = Math.min(str1.length, str2.length);
    let dif_len = 0;
    for (let index = 0; index < min_len; index++) {
      if (str1[index] != str2[index]) {
        dif_len = index;
        break;
      }
    }
    let str1_left = str1.substring(0, dif_len);
    let str1_right = str1.substring(dif_len);
    let str2_left = str2.substring(0, dif_len);
    let str2_right = str2.substring(dif_len);
    result.push(this.mark_diff(str1_left, str1_right));
    result.push(this.mark_diff(str2_left, str2_right));

    return result;
  }

  // 相同前缀也放进代码块, 否则 ** 紧跟在字母数字后面时无法识别为加粗
  private mark_diff(left: string, right: string) {
    const left_str = left ? "`" + left + "`" : "";
    return right ? left_str + this.getRedPre() + right + this.getRedEnd() : left_str;
  }

  private add_color(temp) {
    // let;
    let output_key;
    let expected_key;
    for (const key in temp) {
      if (typeof key == "string") {
        if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
          output_key = key;
        } else if (key.substring(0, 8) == "Expected") {
          expected_key = key;
        }
        if (output_key && expected_key) {
          break;
        }
      }
    }
    if (output_key && expected_key) {
      let output_str = temp[output_key] || [];
      let expected_str = temp[expected_key] || [];
      let min_len = Math.min(output_str.length, expected_str.length);
      let compare_result = temp.system_message.compare_result || ""
      for (let index = 0; index < min_len; index++) {
        if (compare_result[index] != '1' && output_str[index] != expected_str[index]) {
          let temp_result = this.add_color_str(output_str[index], expected_str[index]);
          output_str[index] = temp_result[0] || "";
          expected_str[index] = temp_result[1] || "";
        }
      }
    }
  }

  // 用 ** 而不是 __, 差异从数字或字母后面开始时 __ 不会被识别为加粗
  private getRedPre() {
    return "**`";
  }
  private getRedEnd() {
    return "`**";
  }

  private parseResult(raw: string): IResult {
    let temp = JSON.parse(raw);

    // accepted 只表示代码运行成功, 答案是否正确由 add_color 按用例判断
    if (isAnswerDiffColor()) {
      this.add_color(temp);
    }

    return temp;
  }
}

function trimTailEmpty(lines: string[]): string[] {
  const res = [...(lines || [])];
  while (res.length > 0 && res[res.length - 1] === "") {
    res.pop();
  }
  return res;
}

// markdown 表格单元格里的 | 需要转义
function escapeCell(str: string): string {
  return str.replace(/\|/g, "\\|");
}

interface IResult {
  [key: string]: string[];
  messages: string[];
}

export const submissionService: SubmissionService = new SubmissionService();

export class CommitResultProxy extends BABAProxy {
  static NAME = BabaStr.CommitResultProxy;
  constructor() {
    super(CommitResultProxy.NAME);
  }

  public getTSDByQid(qid: string): ITestSolutionData | undefined {
    return submissionService.getTSDByQid(qid);
  }
}

export class CommitResultMediator extends BABAMediator {
  static NAME = BabaStr.CommitResultMediator;
  constructor() {
    super(CommitResultMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [BabaStr.VSCODE_DISPOST, BabaStr.CommitResult_testSolutionResult, BabaStr.CommitResult_submitSolutionResult];
  }
  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    let body = _notification.getBody();
    switch (_notification.getName()) {
      case BabaStr.VSCODE_DISPOST:
        submissionService.dispose();
        break;

      case BabaStr.CommitResult_testSolutionResult:
        submissionService.show(body.resultString, body.tsd);
        break;
      case BabaStr.CommitResult_submitSolutionResult:
        submissionService.show(body.resultString);
        break;
      default:
        break;
    }
  }
}
