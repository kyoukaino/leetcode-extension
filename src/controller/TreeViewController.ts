/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/controller/TreeViewController.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import * as lodash from "lodash";
import * as path from "path";
import * as vscode from "vscode";
import { toNumber } from "lodash";
import * as fs from "fs";
import { Disposable, window, workspace, ConfigurationChangeEvent } from "vscode";
import {
  SearchNode,
  userContestRankingObj,
  userContestRanKingBase,
  UserStatus,
  IQuickItemEx,
  Category,
  ProblemState,
  SortingStrategy,
  SearchSetTypeName,
  RootNodeSort,
  SearchSetType,
  SORT_ORDER,
  OutPutType,
  TestSolutionType,
  ITestSolutionData,
  defaultTestSolutionData,
} from "../model/ConstDefind";
import {
  isHideSolvedProblem,
  isHideScoreProblem,
  getDescriptionConfiguration,
  isUseEndpointTranslation,
  enableSideMode,
  getPickOneByRankRangeMin,
  getPickOneByRankRangeMax,
  updateSortStrategy,
  getSortingStrategy,
  openSettingsEditor,
  fetchProblemLanguage,
  getBelongingWorkspaceFolderUri,
  selectWorkspaceFolder,
} from "../utils/ConfigUtils";
import { CreateTreeNodeModel, ITodayDataResponse, TreeNodeModel, TreeNodeType, ITreeDataNormal } from "../model/TreeNodeModel";
import { ISearchSet } from "../model/ConstDefind";

import { ShowMessage, promptForSignIn, promptHintMessage } from "../utils/OutputUtils";

import {
  genFileExt,
  genFileName,
  getyyyymmdd,
  getDayNowStr,
  getTextEditorFilePathByUri,
  usingCmd,
} from "../utils/SystemUtils";
import { IDescriptionConfiguration, sortNodeList } from "../utils/ConfigUtils";
import * as systemUtils from "../utils/SystemUtils";

import * as fse from "fs-extra";
import { groupDao } from "../dao/groupDao";
import { fileMeta, ProblemMeta } from "../utils/problemUtils";
import { BABA, BabaStr } from "../BABA";
import { IStudyPlan } from "../studyPlan/StudyPlanModule";

// 视图控制器
class TreeViewController implements Disposable {
  private searchSet: Map<string, ISearchSet> = new Map<string, ISearchSet>();
  private waitTodayQuestion: boolean;
  private waitUserContest: boolean;
  private configurationChangeListener: Disposable;

  constructor() {
    this.configurationChangeListener = workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("leetcode-problem-rating.hideScore")) {
        BABA.sendNotification(BabaStr.ConfigChange_hideScore);
      }
    }, this);
  }

  // 提交问题
  /**
   * It gets the active file path, then submits the solution to the server, and finally refreshes the
   * tree view
   * @param [uri] - The URI of the file to be submitted. If not provided, the currently active file will
   * be submitted.
   * @returns A promise that resolves to a string.
   */
  public async submitSolution(uri?: vscode.Uri): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }

    const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
    if (!filePath) {
      return;
    }

    try {
      const result: string = await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().submitSolution(filePath);

      BABA.sendNotification(BabaStr.CommitResult_submitSolutionResult, { resultString: result });
    } catch (error) {
      await ShowMessage(`提交出错${error}了. 请查看控制台信息~`, OutPutType.error);
      return;
    }
  }

  // 提交测试用例
  /**
   * It takes the current file, and sends it to the server to be tested
   * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
   * file is submitted.
   */
  public async testSolution(uri?: vscode.Uri): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }
      const picks: Array<IQuickItemEx<string>> = [];
      picks.push(
        {
          label: "$(pencil) Write directly...",
          description: "",
          detail: "输入框的测试用例",
          value: ":direct",
        },
        {
          label: "$(file-text) Browse...",
          description: "",
          detail: "文件中的测试用例",
          value: ":file",
        }
      );
      const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
      if (!choice) {
        return;
      }

      let result: string | undefined;
      let testString: string | undefined;
      let testFile: vscode.Uri[] | undefined;

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});

      switch (choice.value) {
        case ":direct":
          testString = await vscode.window.showInputBox({
            prompt: "Enter the test cases.",
            validateInput: (s: string): string | undefined =>
              s && s.trim() ? undefined : "Test case must not be empty.",
            placeHolder: "Example: [1,2,3]\\n4",
            ignoreFocusOut: true,
          });
          if (testString) {
            tsd.filePath = filePath;
            tsd.testString = this.parseTestString(testString);
            tsd.allCase = false;
            tsd.type = TestSolutionType.Type_1;
            result = await BABA.getProxy(BabaStr.ChildCallProxy)
              .get_instance()
              .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
            tsd.result = result;
          }
          break;
        case ":file":
          testFile = await this.showFileSelectDialog(filePath);
          if (testFile && testFile.length) {
            const input: string = (await fse.readFile(testFile[0].fsPath, "utf-8")).trim();
            if (input) {
              tsd.filePath = filePath;
              tsd.testString = this.parseTestString(input.replace(/\r?\n/g, "\\n"));
              tsd.allCase = false;
              result = await BABA.getProxy(BabaStr.ChildCallProxy)
                .get_instance()
                .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
              tsd.result = result;
              tsd.type = TestSolutionType.Type_2;
            } else {
              ShowMessage("The selected test file must not be empty.", OutPutType.error);
            }
          }
          break;
        default:
          break;
      }
      if (!result) {
        return;
      }
      BABA.sendNotification(BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
    } catch (error) {
      await ShowMessage(`提交测试出错${error}了. 请查看控制台信息~`, OutPutType.error);
    }
  }
  /**
   * "Show a file selection dialog, and return the selected file's URI."
   *
   * The function is async, so it returns a promise
   * @param {string} [fsPath] - The path of the file that is currently open in the editor.
   * @returns An array of file URIs or undefined.
   */
  public async showFileSelectDialog(fsPath?: string): Promise<vscode.Uri[] | undefined> {
    const defaultUri: vscode.Uri | undefined = getBelongingWorkspaceFolderUri(fsPath);
    const options: vscode.OpenDialogOptions = {
      defaultUri,
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Select",
    };
    return await vscode.window.showOpenDialog(options);
  }

  /**
   * It gets the active file path, and then calls the BABA.getProxy(BabaStr.ChildCallProxy).get_instance().testSolution function to test the
   * solution
   * @param [uri] - The path of the file to be submitted. If it is not passed, the currently active file
   * is submitted.
   * @param {boolean} [allCase] - Whether to submit all cases.
   * @returns a promise that resolves to void.
   */
  public async testCaseDef(uri?: vscode.Uri, allCase?: boolean): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});
      tsd.filePath = filePath;
      tsd.testString = undefined;
      tsd.allCase = allCase || false;
      tsd.type = TestSolutionType.Type_3;
      let result: string | undefined = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      tsd.result = result;
      if (!result) {
        return;
      }
      BABA.sendNotification(BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
    } catch (error) {
      await ShowMessage(`提交测试出错${error}了. 请查看控制台信息~`, OutPutType.error);
    }
  }

  // 提交测试用例
  /**
   * It takes the current file, and sends it to the server to be tested
   * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
   * file is submitted.
   */
  public async reTestSolution(uri?: vscode.Uri): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }
      const fileContent: Buffer = fs.readFileSync(filePath);
      const meta: ProblemMeta | null = fileMeta(fileContent.toString());

      let qid: string | undefined = undefined;
      if (meta?.id != undefined) {
        qid = BABA.getProxy(BabaStr.QuestionDataProxy).getQidByFid(meta?.id);
      }

      if (qid == undefined) {
        return;
      }

      let tsd: ITestSolutionData | undefined = BABA.getProxy(BabaStr.CommitResultProxy).getTSDByQid(qid);
      if (tsd == undefined) {
        return;
      }

      let result: string | undefined = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      if (!result) {
        return;
      }

      BABA.sendNotification(BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
    } catch (error) {
      await ShowMessage(`提交测试出错${error}了. 请查看控制台信息~`, OutPutType.error);
    }
  }

  /**
   * It gets the active file path, then calls the BABA.getProxy(BabaStr.ChildCallProxy).get_instance().testSolution function to test the
   * solution
   * @param [uri] - The file path of the file to be submitted. If it is not passed in, the currently
   * active file is submitted.
   * @param {string} [testcase] - The test case to be tested. If it is not specified, the test case will
   * be randomly selected.
   * @returns a promise that resolves to void.
   */
  public async tesCaseArea(uri?: vscode.Uri, testcase?: string): Promise<void> {
    try {
      let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
      if (sbp.getStatus() === UserStatus.SignedOut) {
        return;
      }

      const filePath: string | undefined = await getTextEditorFilePathByUri(uri);
      if (!filePath) {
        return;
      }

      let tsd: ITestSolutionData = Object.assign({}, defaultTestSolutionData, {});
      tsd.filePath = filePath;
      tsd.testString = testcase;
      tsd.allCase = false;
      tsd.type = TestSolutionType.Type_4;
      let result: string | undefined = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
      tsd.result = result;
      if (!result) {
        return;
      }

      BABA.sendNotification(BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
    } catch (error) {
      await ShowMessage(`提交测试出错${error}了. 请查看控制台信息~`, OutPutType.error);
    }
  }

  /**
   * If you're on Windows, and you're using cmd.exe, then you need to escape double quotes with
   * backslashes. Otherwise, you don't
   * @param {string} test - The test string to be parsed.
   * @returns a string.
   */
  public parseTestString(test: string): string {
    if (systemUtils.useWsl() || !systemUtils.isWindows()) {
      if (systemUtils.useVscodeNode()) {
        return `${test}`;
      }
      return `'${test}'`;
    }

    if (usingCmd()) {
      // 一般需要走进这里, 除非改了 环境变量ComSpec的值
      if (systemUtils.useVscodeNode()) {
        //eslint-disable-next-line
        return `${test.replace(/"/g, '"')}`;
      }
      return `"${test.replace(/"/g, '\\"')}"`;
    } else {
      if (systemUtils.useVscodeNode()) {
        //eslint-disable-next-line
        return `${test.replace(/"/g, '"')}`;
      }
      return `'${test.replace(/"/g, '\\"')}'`;
    }
  }

  /**
   * It switches the endpoint of LeetCode, and then signs out and signs in again
   * @returns a promise that resolves to a void.
   */

  /**
   * It shows a quick pick menu with the available sorting strategies, and if the user selects one, it
   * updates the sorting strategy and refreshes the tree view
   * @returns A promise that resolves to a void.
   */
  public async switchSortingStrategy(): Promise<void> {
    const currentStrategy: SortingStrategy = getSortingStrategy();
    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      ...SORT_ORDER.map((s: SortingStrategy) => {
        return {
          label: `${currentStrategy === s ? "$(check)" : "    "} ${s}`,
          value: s,
        };
      })
    );

    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
    if (!choice || choice.value === currentStrategy) {
      return;
    }

    await updateSortStrategy(choice.value, true);
  }

  /**
   * It adds a node to the user's favorites
   * @param {TreeNodeModel} node - TreeNodeModel
   */
  public async addFavorite(node: TreeNodeModel): Promise<void> {
    try {
      await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().toggleFavorite(node, true);

      BABA.sendNotification(BabaStr.TreeData_favoriteChange);
    } catch (error) {
      await ShowMessage("添加喜欢题目失败. 请查看控制台信息~", OutPutType.error);
    }
  }

  /**
   * It removes a node from the user's favorites
   * @param {TreeNodeModel} node - The node that is currently selected in the tree.
   */
  public async removeFavorite(node: TreeNodeModel): Promise<void> {
    try {
      await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().toggleFavorite(node, false);
      BABA.sendNotification(BabaStr.TreeData_favoriteChange);
    } catch (error) {
      await ShowMessage("移除喜欢题目失败. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async searchProblem(): Promise<void> {
    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      {
        label: `题目id查询`,
        detail: `通过题目id查询`,
        value: `byid`,
      },
      {
        label: `分数范围查询`,
        detail: `例如 1500-1600`,
        value: `range`,
      },
      {
        label: `周赛期数查询`,
        detail: `周赛期数查询`,
        value: `contest`,
      }
      // {
      //   label: `测试api`,
      //   detail: `测试api`,
      //   value: `testapi`,
      // }
    );
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks, {
      title: "选择查询选项",
    });
    if (!choice) {
      return;
    }

    if (!BABA.getProxy(BabaStr.StatusBarProxy).getUser() && choice.value != "testapi") {
      promptForSignIn();
      return;
    }

    if (choice.value == "byid") {
      await this.searchProblemByID();
    } else if (choice.value == "range") {
      await this.searchScoreRange();
    } else if (choice.value == "contest") {
      await this.searchContest();
    } else if (choice.value == "today") {
      await BABA.getProxy(BabaStr.TodayDataProxy).searchToday();
    } else if (choice.value == "userContest") {
      await this.searchUserContest();
    } else if (choice.value == "testapi") {
      await this.testapi();
    }
  }

  public async getHelp(input: TreeNodeModel | vscode.Uri): Promise<void> {
    let problemInput: string | undefined;
    if (input instanceof TreeNodeModel) {
      // Triggerred from explorer
      problemInput = input.qid;
    } else if (input instanceof vscode.Uri) {
      // Triggerred from Code Lens/context menu
      if (systemUtils.useVscodeNode()) {
        problemInput = `${input.fsPath}`;
      } else {
        problemInput = `"${input.fsPath}"`;
        if (systemUtils.useWsl()) {
          problemInput = await systemUtils.toWslPath(input.fsPath);
        }
      }
    } else if (!input) {
      // Triggerred from command
      problemInput = await getTextEditorFilePathByUri();
    }

    if (!problemInput) {
      ShowMessage("Invalid input to fetch the solution data.", OutPutType.error);
      return;
    }

    const language: string | undefined = await fetchProblemLanguage();
    if (!language) {
      return;
    }

    const picks: Array<IQuickItemEx<string>> = [];
    picks.push(
      {
        label: "获取中文站题解",
        description: "",
        detail: "",
        value: "cn",
      },
      {
        label: "获取英文站题解",
        description: "",
        detail: "",
        value: "en",
      },
      {
        label: "获取提示",
        description: "",
        detail: "",
        value: "cnhints",
      }
    );
    const choice: IQuickItemEx<string> | undefined = await vscode.window.showQuickPick(picks);
    if (!choice) {
      return;
    }

    try {
      if (choice.value == "cn" || choice.value == "en") {
        const solution: string = await BABA.getProxy(BabaStr.ChildCallProxy)
          .get_instance()
          .getHelp(problemInput, language, isUseEndpointTranslation(), choice.value == "cn");
        BABA.getProxy(BabaStr.SolutionProxy).show(solution);
      } else if (choice.value == "cnhints") {
        const hints: string = await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().getHints(problemInput);
        BABA.getProxy(BabaStr.SolutionProxy).show(hints, true);
      }
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await ShowMessage("Failed to fetch the top voted solution. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async testapi(): Promise<void> {
    try {
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await ShowMessage("Failed to fetch today question. 请查看控制台信息~", OutPutType.error);
    }
  }

  public async searchProblemByID(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    const choice: IQuickItemEx<TreeNodeModel> | undefined = await vscode.window.showQuickPick(
      await this.parseProblemsToPicks(BABA.getProxy(BabaStr.QuestionDataProxy).getfidMapQuestionData()),
      {
        matchOnDetail: true,
        matchOnDescription: true,
        placeHolder: "Select one problem",
      }
    );
    if (!choice) {
      return;
    }
    await this.showProblemInternal(choice.value);
  }

  public async showProblem(node?: TreeNodeModel): Promise<void> {
    if (!node) {
      return;
    }
    await this.showProblemInternal(node);
  }

  public async pickOne(): Promise<void> {
    const picks: Array<IQuickItemEx<string>> = [];

    let last_pick = await groupDao.getPickOneTags();

    let last_tag_set: Set<string> = new Set<string>();
    last_pick.forEach((tag_name) => {
      last_tag_set.add(tag_name);
    });

    for (const tag of BABA.getProxy(BabaStr.QuestionDataProxy).getTagSet().values()) {
      let pick_item: IQuickItemEx<string> = {
        label: tag,
        detail: "",
        value: tag,
      };
      if (last_tag_set.has(tag)) {
        pick_item.picked = true;
      }

      picks.push(pick_item);
    }

    const user_score = BABA.getProxy(BabaStr.StatusBarProxy).getUserContestScore() || 0;
    let min_score: number = getPickOneByRankRangeMin();
    let max_score: number = getPickOneByRankRangeMax();
    const need_min = user_score + min_score;
    const need_max = user_score + max_score;

    const choice: Array<IQuickItemEx<string>> | undefined = await window.showQuickPick(picks, {
      title: user_score > 0 ? `手气一下,score:[${Math.ceil(need_min)} - ${Math.floor(need_max)}]` : "手气一下",
      matchOnDescription: false,
      matchOnDetail: false,
      placeHolder: "指定Tag类型",
      canPickMany: true,
    });
    if (!choice) {
      return;
    }

    // 写入选择
    let cur_tag_set: Set<string> = new Set<string>();
    choice.forEach((element) => {
      cur_tag_set.add(element.value);
    });

    const problems: TreeNodeModel[] = await BABA.getProxy(BabaStr.QuestionDataProxy).getfidMapQuestionData();
    let randomProblem: TreeNodeModel;


    if (user_score > 0) {
      let temp_problems: TreeNodeModel[] = [];
      problems.forEach((element) => {
        if (BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(element.id)?.Rating) {
          if (
            BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(element.id).Rating >= need_min &&
            BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(element.id).Rating <= need_max
          ) {
            for (const q_tag of BABA.getProxy(BabaStr.TreeDataProxy).getTagsData(element.id)) {
              if (cur_tag_set.has(q_tag)) {
                temp_problems.push(element);
              }
            }
          }
        }
      });
      randomProblem = temp_problems[Math.floor(Math.random() * temp_problems.length)];
    } else {
      randomProblem = problems[Math.floor(Math.random() * problems.length)];
    }
    if (randomProblem) {
      await this.showProblemInternal(randomProblem);
    }

    // 写入
    let new_pick_one_tags: Array<string> = [];
    for (const new_tag of cur_tag_set) {
      new_pick_one_tags.push(new_tag);
    }
    await groupDao.setPickOneTags(new_pick_one_tags);
  }

  public async showProblemInternal(node: TreeNodeModel): Promise<void> {
    try {
      const language: string | undefined = await fetchProblemLanguage();
      if (!language) {
        return;
      }

      const leetCodeConfig: vscode.WorkspaceConfiguration =
        vscode.workspace.getConfiguration("leetcode-problem-rating");
      const workspaceFolder: string = await selectWorkspaceFolder();
      if (!workspaceFolder) {
        return;
      }

      const fileFolder: string = leetCodeConfig
        .get<string>(`filePath.${language}.folder`, leetCodeConfig.get<string>(`filePath.default.folder`, ""))
        .trim();
      const fileName: string = leetCodeConfig
        .get<string>(
          `filePath.${language}.filename`,
          leetCodeConfig.get<string>(`filePath.default.filename`) || genFileName(node, language)
        )
        .trim();

      let finalPath: string = path.join(workspaceFolder, fileFolder, fileName);

      if (finalPath) {
        finalPath = await this.resolveRelativePath(finalPath, node, language);
        if (!finalPath) {
          BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine("Showing problem canceled by user.");
          return;
        }
      }

      finalPath = systemUtils.useWsl() ? await systemUtils.toWinPath(finalPath) : finalPath;

      const descriptionConfig: IDescriptionConfiguration = getDescriptionConfiguration();
      const needTranslation: boolean = isUseEndpointTranslation();

      let show_code = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .showProblem(node, language, finalPath, descriptionConfig.showInComment, needTranslation);
      if (show_code == 100) {
        const promises: any[] = [
          vscode.window
            .showTextDocument(vscode.Uri.file(finalPath), {
              preview: false,
              viewColumn: vscode.ViewColumn.One,
            })
            .then(
              (editor) => {
                BABA.sendNotification(BabaStr.showProblemFinishOpen, { node: node, editor: editor });
              },
              (error) => {
                BABA.sendNotification(BabaStr.showProblemFinishError, { node: node, error: error });
              }
            ),
          promptHintMessage(
            "hint.commentDescription",
            'You can config how to show the problem description through "leetcode-problem-rating.showDescription".',
            "Open settings",
            (): Promise<any> => openSettingsEditor("leetcode-problem-rating.showDescription")
          ),
        ];
        if (descriptionConfig.showInWebview) {
          promises.push(this.showDescriptionView(node));
        }
        promises.push(
          new Promise(async (resolve, _) => {
            BABA.sendNotification(BabaStr.showProblemFinish, node);
            resolve(1);
          })
        );

        await Promise.all(promises);
      }
    } catch (error) {
      await ShowMessage(`${error} 请查看控制台信息~`, OutPutType.error);
    }
  }

  public async showDescriptionView(node: TreeNodeModel): Promise<void> {
    BABA.sendNotification(BabaStr.BABACMD_previewProblem, { input: node, isSideMode: enableSideMode() });
  }

  public async searchScoreRange(): Promise<void> {
    const twoFactor: string | undefined = await vscode.window.showInputBox({
      prompt: "输入分数范围 低分-高分 例如: 1500-1600",
      ignoreFocusOut: true,
      validateInput: (s: string): string | undefined => (s && s.trim() ? undefined : "The input must not be empty"),
    });

    // vscode.window.showErrorMessage(twoFactor || "输入错误");
    const tt = Object.assign({}, SearchNode, {
      value: twoFactor,
      type: SearchSetType.ScoreRange,
      time: Math.floor(Date.now() / 1000),
    });
    treeViewController.insertSearchSet(tt);
    BABA.sendNotification(BabaStr.TreeData_searchScoreRangeFinish);
  }

  public async searchContest(): Promise<void> {
    const twoFactor: string | undefined = await vscode.window.showInputBox({
      prompt: "单期数 例如: 300 或者 输入期数范围 低期数-高期数 例如: 303-306",
      ignoreFocusOut: true,
      validateInput: (s: string): string | undefined => (s && s.trim() ? undefined : "The input must not be empty"),
    });

    // vscode.window.showErrorMessage(twoFactor || "输入错误");
    const tt = Object.assign({}, SearchNode, {
      value: twoFactor,
      type: SearchSetType.Context,
      time: Math.floor(Date.now() / 1000),
    });
    treeViewController.insertSearchSet(tt);
    BABA.sendNotification(BabaStr.TreeData_searchContest);
  }

  public async searchUserContest(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      promptForSignIn();
      return;
    }
    try {
      const needTranslation: boolean = isUseEndpointTranslation();
      const solution: string = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .getUserContest(needTranslation, sbp.getUser() || "");
      const query_result = JSON.parse(solution);
      const tt: userContestRanKingBase = Object.assign({}, userContestRankingObj, query_result.userContestRanking);
      BABA.sendNotification(BabaStr.TreeData_searchUserContest, tt);
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
      await ShowMessage("Failed to fetch today question. 请查看控制台信息~", OutPutType.error);
    }
  }

  public parseProblemsToPicks(p: TreeNodeModel[]): Array<IQuickItemEx<TreeNodeModel>> {
    const picks: Array<IQuickItemEx<TreeNodeModel>> = [];
    p.forEach((problem: TreeNodeModel) => {
      picks.push(
        Object.assign(
          {},
          {
            label: `${this.parseProblemDecorator(problem.state, problem.locked)}${problem.id}.${problem.name}`,
            description: `QID:${problem.qid}`,
            detail:
              ((problem.scoreData?.score || "0") > "0" ? "score: " + problem.scoreData?.score + " , " : "") +
              `AC rate: ${problem.passRate}, Difficulty: ${problem.difficulty}`,
            value: problem,
          }
        )
      );
    });
    return picks;
  }

  public parseProblemDecorator(state: ProblemState, locked: boolean): string {
    switch (state) {
      case ProblemState.AC:
        return "$(check) ";
      case ProblemState.NotAC:
        return "$(x) ";
      default:
        return locked ? "$(lock) " : "";
    }
  }

  public async resolveRelativePath(
    relativePath: string,
    node: TreeNodeModel,
    selectedLanguage: string
  ): Promise<string> {
    let tag: string = "";
    if (/\$\{tag\}/i.test(relativePath)) {
      tag = (await this.resolveTagForProblem(node)) || "";
    }

    let company: string = "";
    if (/\$\{company\}/i.test(relativePath)) {
      company = (await this.resolveCompanyForProblem(node)) || "";
    }

    let errorMsg: string;
    return relativePath.replace(/\$\{(.*?)\}/g, (_substring: string, ...args: string[]) => {
      const placeholder: string = args[0].toLowerCase().trim();
      switch (placeholder) {
        case "id":
          return node.id;
        case "cnname":
        case "cn_name":
          return node.cn_name || node.name;
        case "name":
          return node.en_name || node.name;
        case "camelcasename":
          return lodash.camelCase(node.en_name || node.name);
        case "pascalcasename":
          return lodash.upperFirst(lodash.camelCase(node.en_name || node.name));
        case "kebabcasename":
        case "kebab-case-name":
          return lodash.kebabCase(node.en_name || node.name);
        case "snakecasename":
        case "snake_case_name":
          return lodash.snakeCase(node.en_name || node.name);
        case "ext":
          return genFileExt(selectedLanguage);
        case "language":
          return selectedLanguage;
        case "difficulty":
          return node.difficulty.toLocaleLowerCase();
        case "tag":
          return tag;
        case "company":
          return company;
        case "yyyymmdd":
          return getyyyymmdd(undefined);
        case "timestamp":
          return getDayNowStr();
        default:
          errorMsg = `The config '${placeholder}' is not supported.`;
          BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(errorMsg);
          throw new Error(errorMsg);
      }
    });
  }

  public async resolveTagForProblem(problem: TreeNodeModel): Promise<string | undefined> {
    let path_en_tags = BABA.getProxy(BabaStr.TreeDataProxy).getTagsDataEn(problem.id);
    if (path_en_tags.length === 1) {
      return path_en_tags[0];
    }
    return await vscode.window.showQuickPick(path_en_tags, {
      matchOnDetail: true,
      placeHolder: "Multiple tags available, please select one",
      ignoreFocusOut: true,
    });
  }

  public async resolveCompanyForProblem(problem: TreeNodeModel): Promise<string | undefined> {
    if (problem.companies.length === 1) {
      return problem.companies[0];
    }
    return await vscode.window.showQuickPick(problem.companies, {
      matchOnDetail: true,
      placeHolder: "Multiple tags available, please select one",
      ignoreFocusOut: true,
    });
  }

  public insertSearchSet(tt: ISearchSet) {
    this.searchSet.set(tt.value, tt);
  }
  public clearUserScore() {
    this.waitUserContest = false;
    this.waitTodayQuestion = false;
    this.searchSet = new Map<string, ISearchSet>();
  }

  public async refreshCheck(): Promise<void> {
    let sbp = BABA.getProxy(BabaStr.StatusBarProxy);
    if (!sbp.getUser()) {
      return;
    }
    // const day_start = systemUtils.getDayStart(); //获取当天零点的时间
    // const day_end = systemUtils.getDayEnd(); //获取当天23:59:59的时间
    // let need_get_today: boolean = true;
    // this.searchSet.forEach((element) => {
    //   if (element.type == SearchSetType.Day) {
    //     if (day_start <= element.time && element.time <= day_end) {
    //       need_get_today = false;
    //     } else {
    //       this.waitTodayQuestion = false;
    //     }
    //   }
    // });
    // if (need_get_today && !this.waitTodayQuestion) {
    //   this.waitTodayQuestion = true;
    //   await BABA.getProxy(BabaStr.TodayDataProxy).searchToday();
    // }

    const user_score = BABA.getProxy(BabaStr.StatusBarProxy).getUserContestScore();
    if (!user_score && !this.waitUserContest) {
      this.waitUserContest = true;
      await this.searchUserContest();
    }
  }

  public async refreshCache(): Promise<void> {
    const temp_searchSet: Map<string, ISearchSet> = this.searchSet;
    const temp_waitTodayQuestion: boolean = this.waitTodayQuestion;
    const temp_waitUserContest: boolean = this.waitUserContest;
    BABA.sendNotification(BabaStr.QuestionData_ReBuildQuestionData);
    this.searchSet = temp_searchSet;
    this.waitTodayQuestion = temp_waitTodayQuestion;
    this.waitUserContest = temp_waitUserContest;
  }

  public getRootNodes(): TreeNodeModel[] {
    const baseNode: TreeNodeModel[] = [
      CreateTreeNodeModel(
        {
          id: Category.All,
          name: Category.All,
          rootNodeSortId: RootNodeSort.All,
        },
        TreeNodeType.Tree_All
      ),
      CreateTreeNodeModel(
        {
          id: Category.Difficulty,
          name: Category.Difficulty,
          rootNodeSortId: RootNodeSort.Difficulty,
        },
        TreeNodeType.Tree_difficulty
      ),
      CreateTreeNodeModel(
        {
          id: Category.Tag,
          name: Category.Tag,
          rootNodeSortId: RootNodeSort.Tag,
        },
        TreeNodeType.Tree_tag
      ),
      CreateTreeNodeModel(
        {
          id: Category.Favorite,
          name: Category.Favorite,
          rootNodeSortId: RootNodeSort.Favorite,
        },
        TreeNodeType.Tree_favorite
      ),
      CreateTreeNodeModel(
        {
          id: Category.Score,
          name: Category.Score,
          rootNodeSortId: RootNodeSort.Score,
        },
        TreeNodeType.Tree_score
      ),
      CreateTreeNodeModel(
        {
          id: Category.Choice,
          name: Category.Choice,
          rootNodeSortId: RootNodeSort.Choice,
        },
        TreeNodeType.Tree_choice
      ),
      CreateTreeNodeModel(
        {
          id: Category.Contest,
          name: Category.Contest,
          rootNodeSortId: RootNodeSort.Contest,
        },
        TreeNodeType.Tree_contest
      ),
      // CreateTreeNodeModel(
      //   {
      //     id: Category.RecentContestList,
      //     name: Category.RecentContestList,
      //     rootNodeSortId: RootNodeSort.RecentContestList,
      //   },
      //   TreeNodeType.Tree_recentContestList
      // ),
    ];

    // 获取每日一题的数据

    let today_info = BABA.getProxy(BabaStr.TodayDataProxy).getAllTodayData();
    today_info.forEach((element: ITodayDataResponse) => {
      const curDate = new Date(element.time * 1000);
      baseNode.push(
        CreateTreeNodeModel(
          {
            id: element.fid,
            name: `[${curDate.getFullYear()}-${curDate.getMonth() + 1}-${curDate.getDate()}]${SearchSetTypeName[SearchSetType.Day]
              }`,
            isSearchResult: true,
            rootNodeSortId: RootNodeSort.Day,
          },
          TreeNodeType.Tree_day
        )
      );
    });

    this.searchSet.forEach((element) => {
      baseNode.push(
        CreateTreeNodeModel(
          {
            id: element.type,
            name: SearchSetTypeName[element.type] + element.value,
            input: element.value,
            isSearchResult: true,
            rootNodeSortId: RootNodeSort[element.type],
          },
          TreeNodeType.Tree_search
        )
      );
    });
    baseNode.sort(function (a: TreeNodeModel, b: TreeNodeModel): number {
      if (a.rootNodeSortId < b.rootNodeSortId) {
        return -1;
      } else if (a.rootNodeSortId > b.rootNodeSortId) {
        return 1;
      }
      return 0;
    });
    return baseNode;
  }

  public getScoreRangeNodes(rank_range: string): TreeNodeModel[] {
    const sorceNode: TreeNodeModel[] = [];
    const rank_r: Array<string> = rank_range.split("-");
    let rank_a = Number(rank_r[0]);
    let rank_b = Number(rank_r[1]);
    if (rank_a > 0 && rank_b > 0) {
      if (rank_a > rank_b) {
        const rank_c: number = rank_a;
        rank_a = rank_b;
        rank_b = rank_c;
      }

      BABA.getProxy(BabaStr.QuestionDataProxy)
        .getfidMapQuestionData()
        .forEach((element) => {
          if (!this.canShow(element)) {
            return;
          }
          if (rank_a <= Number(element.score) && Number(element.score) <= rank_b) {
            sorceNode.push(CreateTreeNodeModel(element.get_data(), TreeNodeType.Tree_search_score_leaf));
          }
        });
    }
    return sortNodeList(sorceNode);
  }

  public canShow(element: TreeNodeModel) {
    if (isHideSolvedProblem() && element.state === ProblemState.AC) {
      return false;
    }
    if (isHideScoreProblem(element)) {
      return false;
    }
    return true;
  }

  public getContestNodes(rank_range: string): TreeNodeModel[] {
    const sorceNode: TreeNodeModel[] = [];
    const rank_r: Array<string> = rank_range.split("-");
    let rank_a = Number(rank_r[0]);
    let rank_b = Number(rank_r[1]);
    if (rank_a > 0) {
      BABA.getProxy(BabaStr.QuestionDataProxy)
        .getfidMapQuestionData()
        .forEach((element) => {
          const slu = element.ContestSlug;
          const slu_arr: Array<string> = slu.split("-");
          const slu_id = Number(slu_arr[slu_arr.length - 1]);
          if (rank_b > 0 && rank_a <= slu_id && slu_id <= rank_b) {
            sorceNode.push(CreateTreeNodeModel(element.get_data(), TreeNodeType.Tree_search_contest_leaf));
          } else if (rank_a == slu_id) {
            sorceNode.push(CreateTreeNodeModel(element.get_data(), TreeNodeType.Tree_search_contest_leaf));
          }
        });
    }
    return sortNodeList(sorceNode);
  }
  public getDayNodes(element: TreeNodeModel | undefined): TreeNodeModel[] {
    const fid: string = element?.id || "";
    const sorceNode: TreeNodeModel[] = [];
    // 获取这题的数据
    let DayQuestionNode: TreeNodeModel | undefined = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeById(fid);

    if (DayQuestionNode != undefined) {
      sorceNode.push(CreateTreeNodeModel(DayQuestionNode.get_data(), TreeNodeType.Tree_day_leaf));
    }

    return sortNodeList(sorceNode);
  }

  public getRecentContestList(): TreeNodeModel[] {
    const sorceNode: TreeNodeModel[] = [];
    let recentContestNodeList: ITreeDataNormal[] | undefined = BABA.getProxy(BabaStr.RecentContestProxy).getAllContestTreeNode();

    if (recentContestNodeList != undefined) {
      for (let i = 0; i < recentContestNodeList.length; i++) {
        sorceNode.push(CreateTreeNodeModel(recentContestNodeList[i], TreeNodeType.Tree_recentContestList_contest));
      }
    }
    return sortNodeList(sorceNode);
  }

  public getContestQuestionNodes(element: TreeNodeModel): TreeNodeModel[] {
    const sorceNode: TreeNodeModel[] = [];
    let questionList = BABA.getProxy(BabaStr.ContestQuestionProxy).getContestQuestionData(element.id);
    for (let question of questionList) {
      let DayQuestionNode: TreeNodeModel | undefined = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeByQid(question);
      if (DayQuestionNode != undefined) {
        sorceNode.push(CreateTreeNodeModel(DayQuestionNode.get_data(), TreeNodeType.Tree_recentContestList_contest_leaf));
      }
    }
    return sortNodeList(sorceNode);
  }

  public getAllNodes(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];

    BABA.getProxy(BabaStr.QuestionDataProxy)
      .getfidMapQuestionData()
      .forEach((node) => {
        if (this.canShow(node)) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_All_leaf));
        }
      });
    return sortNodeList(res);
  }

  public getDifficultyChild(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];
    res.push(
      CreateTreeNodeModel(
        {
          id: `Easy`,
          name: "Easy",
          rootNodeSortId: RootNodeSort.DIFEASY,
        },
        TreeNodeType.Tree_difficulty_easy
      ),
      CreateTreeNodeModel(
        {
          id: `Medium`,
          name: "Medium",
          rootNodeSortId: RootNodeSort.DIFMID,
        },
        TreeNodeType.Tree_difficulty_mid
      ),
      CreateTreeNodeModel(
        {
          id: `Hard`,
          name: "Hard",
          rootNodeSortId: RootNodeSort.DIFHARD,
        },
        TreeNodeType.Tree_difficulty_hard
      )
    );
    return res;
  }

  public getScoreChild(): TreeNodeModel[] {
    const user_score = BABA.getProxy(BabaStr.StatusBarProxy).getUserContestScore();
    const res: TreeNodeModel[] = [];
    const score_array: Array<string> = [
      "3300",
      "3200",
      "3100",
      "3000",
      "2900",
      "2800",
      "2700",
      "2600",
      "2500",
      "2400",
      "2300",
      "2200",
      "2100",
      "2000",
      "1900",
      "1800",
      "1700",
      "1600",
      "1500",
      "1400",
      "1300",
      "1200",
      "1100",
    ];
    score_array.forEach((score_str) => {
      const temp_num = Number(score_str);
      const diff = Math.abs(temp_num - user_score);
      if (diff <= 200) {
        res.push(
          CreateTreeNodeModel(
            {
              id: `${score_str}`,
              name: `${score_str}`,
              rootNodeSortId: temp_num,
            },
            TreeNodeType.Tree_score_fen
          )
        );
      }
    });
    return res;
  }

  public getContestChild(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];
    res.push(
      CreateTreeNodeModel(
        {
          id: `Q1`,
          name: "Q1",
          rootNodeSortId: 1,
        },
        TreeNodeType.Tree_contest_Q1
      ),
      CreateTreeNodeModel(
        {
          id: `Q2`,
          name: "Q2",
          rootNodeSortId: 2,
        },
        TreeNodeType.Tree_contest_Q2
      ),
      CreateTreeNodeModel(
        {
          id: `Q3`,
          name: "Q3",
          rootNodeSortId: 3,
        },
        TreeNodeType.Tree_contest_Q3
      ),
      CreateTreeNodeModel(
        {
          id: `Q4`,
          name: "Q4",
          rootNodeSortId: 4,
        },
        TreeNodeType.Tree_contest_Q4
      )
    );
    return res;
  }
  public getChoiceChild(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];

    const all_choice = BABA.getProxy(BabaStr.TreeDataProxy).getChoiceData();
    all_choice.forEach((element) => {
      res.push(
        CreateTreeNodeModel(
          {
            id: `${element.id}`,
            name: `${element.name}`,
            rootNodeSortId: 4,
          },
          TreeNodeType.Tree_choice_fenlei
        )
      );
    });
    return res;
  }

  // 精选题单的下一层: 有学习计划的按官网分组, 否则直接列出内置题目
  public async getChoicePlanChild(choiceNode: TreeNodeModel): Promise<TreeNodeModel[]> {
    const choice = BABA.getProxy(BabaStr.TreeDataProxy)
      .getChoiceData()
      .find((element) => element.id == choiceNode.id);
    if (!choice) {
      return [];
    }

    if (choice.planSlug) {
      const plan: IStudyPlan | undefined = await BABA.getProxy(BabaStr.StudyPlanProxy).getStudyPlan(choice.planSlug);
      if (plan) {
        return plan.groups.map((group, index) => {
          const nodes = this.getQuestionNodesByFid(group.questions);
          const acCount = nodes.filter((node) => node.state === ProblemState.AC).length;
          return CreateTreeNodeModel(
            {
              id: `${choice.id}#${index}`,
              name: `${group.name} (${acCount}/${group.questions.length})`,
              rootNodeSortId: 4,
            },
            TreeNodeType.Tree_choice_fenlei_group
          );
        });
      }
      // 学习计划获取失败, 内置题单存的是 fid, 保持学习计划的顺序
      return this.toChoiceLeafNodes(this.getQuestionNodesByFid(choice.questions));
    }

    // 其他内置题单存的是 qid
    const res: TreeNodeModel[] = [];
    choice.questions.forEach((qid) => {
      const node = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeByQid(String(qid));
      if (node) {
        res.push(node);
      }
    });
    return sortNodeList(this.toChoiceLeafNodes(res));
  }

  // 学习计划分组下的题目, 保持官网顺序
  public async getChoiceGroupChild(groupNode: TreeNodeModel): Promise<TreeNodeModel[]> {
    const [choiceId, groupIndex] = groupNode.id.split("#");
    const choice = BABA.getProxy(BabaStr.TreeDataProxy)
      .getChoiceData()
      .find((element) => element.id == choiceId);
    if (!choice?.planSlug) {
      return [];
    }
    const plan: IStudyPlan | undefined = await BABA.getProxy(BabaStr.StudyPlanProxy).getStudyPlan(choice.planSlug);
    const group = plan?.groups[Number(groupIndex)];
    if (!group) {
      return [];
    }
    return this.toChoiceLeafNodes(this.getQuestionNodesByFid(group.questions));
  }

  private getQuestionNodesByFid(fids: Array<string | number>): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];
    fids.forEach((fid) => {
      const node = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeById(String(fid));
      if (node) {
        res.push(node);
      }
    });
    return res;
  }

  private toChoiceLeafNodes(nodes: TreeNodeModel[]): TreeNodeModel[] {
    return nodes
      .filter((node) => this.canShow(node))
      .map((node) => CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_choice_fenlei_leaf));
  }

  public getTagChild(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];
    for (const tag of BABA.getProxy(BabaStr.QuestionDataProxy).getTagSet().values()) {
      res.push(
        CreateTreeNodeModel(
          {
            id: `${tag}`,
            name: lodash.startCase(tag),
            rootNodeSortId: 4,
          },
          TreeNodeType.Tree_tag_fenlei
        )
      );
    }
    this.sortSubCategoryNodes(res, Category.Tag);
    return res;
  }

  public getFavoriteNodes(): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];
    BABA.getProxy(BabaStr.QuestionDataProxy)
      .getfidMapQuestionData()
      .forEach((node) => {
        if (this.canShow(node) && node.isFavorite) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_favorite_leaf));
        }
      });
    return sortNodeList(res);
  }

  // 第二层取第三层的叶子
  public getChildrenSon(TreeChildNode: TreeNodeModel): TreeNodeModel[] {
    const res: TreeNodeModel[] = [];

    for (const node of BABA.getProxy(BabaStr.QuestionDataProxy).getfidMapQuestionData().values()) {
      if (!this.canShow(node)) {
        continue;
      }
      if (TreeChildNode.nodeType == TreeNodeType.Tree_difficulty_easy) {
        if (node.get_data().difficulty === TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_difficulty_easy_leaf));

        }
      }
      else if (TreeChildNode.nodeType == TreeNodeType.Tree_difficulty_mid) {
        if (node.get_data().difficulty === TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_difficulty_mid_leaf));

        }
      }
      else if (TreeChildNode.nodeType == TreeNodeType.Tree_difficulty_hard) {
        if (node.get_data().difficulty === TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_difficulty_hard_leaf));

        }
      }
      else if (TreeChildNode.nodeType == TreeNodeType.Tree_tag_fenlei) {
        if (node.tags.indexOf(TreeChildNode.id) >= 0) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_tag_fenlei_leaf));
        }
      }

      else if (TreeChildNode.nodeType == TreeNodeType.Tree_score_fen) {
        if (node.score > "0") {
          const check_rank = toNumber(TreeChildNode.id);
          const node_rank = toNumber(node.score);
          if (check_rank <= node_rank && node_rank < check_rank + 100) {
            res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_score_fen_leaf));
          }
        }
      }

      else if (TreeChildNode.nodeType == TreeNodeType.Tree_contest_Q1) {
        if (node.ProblemIndex == TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_contest_Q1_leaf));
        }
      }

      else if (TreeChildNode.nodeType == TreeNodeType.Tree_contest_Q2) {
        if (node.ProblemIndex == TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_contest_Q2_leaf));
        }
      }

      else if (TreeChildNode.nodeType == TreeNodeType.Tree_contest_Q3) {
        if (node.ProblemIndex == TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_contest_Q3_leaf));
        }
      }

      else if (TreeChildNode.nodeType == TreeNodeType.Tree_contest_Q4) {
        if (node.ProblemIndex == TreeChildNode.id) {
          res.push(CreateTreeNodeModel(node.get_data(), TreeNodeType.Tree_contest_Q4_leaf));
        }
      }


    }
    return sortNodeList(res);
  }

  public dispose(): void {
    this.configurationChangeListener.dispose();
    BABA.sendNotification(BabaStr.QuestionData_clearCache);
  }

  private sortSubCategoryNodes(subCategoryNodes: TreeNodeModel[], category: Category): void {
    switch (category) {
      case Category.Tag:
        subCategoryNodes.sort((a: TreeNodeModel, b: TreeNodeModel): number => {
          if (a.name === "Unknown") {
            return 1;
          } else if (b.name === "Unknown") {
            return -1;
          } else {
            return Number(a.name > b.name) - Number(a.name < b.name);
          }
        });
        break;
      default:
        break;
    }
  }
}

export const treeViewController: TreeViewController = new TreeViewController();
