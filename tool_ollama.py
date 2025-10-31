import ollama
import json

class FinanceAssistantLocal:
    def __init__(self, model_name: str = "qwen3:8b", system_prompt: str = None):

        self.model_name = model_name
        self.tool_manager = ToolManager()
        self.conversation_history = []

        # 設置系統提示詞
        if system_prompt is None:
            system_prompt = """你是一個專業的財務分析助理。你的任務是：
1. 幫助用戶分析財務數據，提供專業建議
2. 使用提供的財務計算工具進行精確計算
3. 用清晰易懂的方式解釋財務指標
4. 指出財務報表中的風險和機會

重要規則：
- 所有回答必須使用繁體中文（Traditional Chinese）
- 思考過程（<think>）也必須使用繁體中文
- 不要使用簡體中文

請以專業但友善的態度回答問題。"""

        self.conversation_history.append({
            "role": "system",
            "content": system_prompt
        })

        # 驗證模型是否可用
        try:
            ollama.list()
            print(f"✓ 使用本地模型: {model_name}")
        except Exception as e:
            print(f"✗ Ollama 未運行或模型不存在，請確認:")
            print(f"  1. Ollama 已安裝並運行")
            print(f"  2. 已執行: ollama pull {model_name}")
            raise e

    def _convert_tools_to_ollama_format(self):

        tools = []
        for schema in self.tool_manager.get_tool_schemas():
            tool = {
                "type": "function",
                "function": {
                    "name": schema["name"],
                    "description": schema["description"],
                    "parameters": schema["input_schema"]
                }
            }
            tools.append(tool)
        return tools

    def _remove_think_tags(self, text: str) -> str:
        
        import re
        # 移除 <think>...</think> 標籤及其內容
        cleaned = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
        # 移除多餘的空白行
        cleaned = re.sub(r'\n\s*\n\s*\n', '\n\n', cleaned)
        return cleaned.strip()

    def chat(self, user_message: str):
        try:
            self.conversation_history.append({
                "role": "user",
                "content": user_message
            })

            tools = self._convert_tools_to_ollama_format()

            # 首次調用模型
            response = ollama.chat(
                model=self.model_name,
                messages=self.conversation_history,
                tools=tools,
            )

            # 處理工具調用循環
            max_iterations = 10  # 防止無限循環
            iteration = 0

            while response.get('message', {}).get('tool_calls') and iteration < max_iterations:
                iteration += 1
                self.conversation_history.append(response['message'])

                # 執行所有工具調用
                for tool_call in response['message']['tool_calls']:
                    tool_name = tool_call['function']['name']
                    tool_input = tool_call['function']['arguments']

                    print(f"\n🔧 調用工具: {tool_name}")
                    print(f"📝 參數: {tool_input}")

                    # 執行工具
                    result = self.tool_manager.execute_tool(tool_name, tool_input)
                    print(f"✓ 結果: {result}\n")

                    # 添加工具結果到對話歷史
                    self.conversation_history.append({
                        "role": "tool",
                        "content": json.dumps(result, ensure_ascii=False)
                    })

                # 繼續對話
                response = ollama.chat(
                    model=self.model_name,
                    messages=self.conversation_history,
                    tools=tools,
                )

            if iteration >= max_iterations:
                return "工具調用次數超過限制，請重新提問或簡化問題。"

            # 獲取最終回覆
            assistant_message = response['message']['content']
            self.conversation_history.append({
                "role": "assistant",
                "content": assistant_message
            })

            # 過濾 <think> 標籤（可選）
            cleaned_message = self._remove_think_tags(assistant_message)

            return cleaned_message

        except Exception as e:
            error_msg = f"❌ 處理對話時發生錯誤: {str(e)}"
            print(error_msg)
            return error_msg

    def clear_history(self):

        self.conversation_history = self.conversation_history[:1]
        print("✓ 對話歷史已清空")

    def summarize_history(self, keep_recent: int = 2):

        # 檢查是否需要摘要（至少要有 keep_recent + 5 則訊息才值得摘要）
        if len(self.conversation_history) <= keep_recent + 5:
            print("✓ 對話歷史不需要摘要")
            return

        print(f"📝 開始摘要對話歷史...")

        # 分割對話：系統提示詞 | 要摘要的舊對話 | 最近的對話
        system_prompt = self.conversation_history[0]
        messages_to_summarize = self.conversation_history[1:-keep_recent]  # 舊對話
        recent_messages = self.conversation_history[-keep_recent:]         # 最近的對話

        # 將要摘要的對話轉成文字格式
        conversation_text = ""
        for msg in messages_to_summarize:
            role = msg['role']
            content = msg['content']
            conversation_text += f"{role}: {content}\n\n"

        # 建立摘要提示詞
        summary_prompt = f"""請將以下對話歷史總結成簡潔的摘要，保留關鍵資訊：

{conversation_text}

請用 2-3 段文字總結上述對話的重點，包括：
- 用戶提出的主要問題
- 執行的財務計算和結果
- 重要的財務數據和結論"""

        # 呼叫模型進行摘要
        try:
            response = ollama.chat(
                model=self.model_name,
                messages=[{"role": "user", "content": summary_prompt}]
            )
            summary = response['message']['content']
        except Exception as e:
            print(f"❌ 摘要失敗: {str(e)}")
            return

        # 重建對話歷史：[系統提示詞] + [摘要] + [最近的對話]
        summary_message = {
            "role": "system",
            "content": f"先前對話摘要：\n{summary}"
        }

        self.conversation_history = [system_prompt, summary_message] + recent_messages

        print(f"✓ 摘要完成！從 {len(messages_to_summarize)} 則訊息壓縮成摘要，保留最近 {keep_recent} 則訊息")
        print(f"✓ 目前對話歷史長度: {len(self.conversation_history)} 則訊息")

# ===== 原有的工具定義 =====
calculate_roe_schema = {
    "name": "calculate_roe",
    "description": "計算股東權益報酬率 (ROE)",
    "input_schema": {
        "type": "object",
        "properties": {
            "net_income": {
                "type": "number",
                "description": "稅後淨利(元)"
            },
            "shareholder_equity": {
                "type": "number",
                "description": "股東權益(元)"
            }
        },
        "required": ["net_income", "shareholder_equity"]
    }
}

def calculate_roe(net_income, shareholder_equity):
    if shareholder_equity == 0:
        return {
            "roe": None,
            "message": "股東權益不能為零，無法計算ROE。"
        }
    roe = net_income / shareholder_equity
    roe_percentage = f"{roe*100:.2f}%"

    if roe > 0.15:
        interpretation = "優秀>15%"
    elif roe > 0.10:
        interpretation = "良好10%-15%"
    elif roe > 0.05:
        interpretation = "一般5%-10%"
    else:
        interpretation = "較差<5%"
    
    return {
        "roe": roe_percentage,
        "interpretation": interpretation,
        "net_income": net_income,
        "shareholder_equity": shareholder_equity
    }


calculate_income_statement_schema = {
    "name": "calculate_income_statement",
    "description": "根據基礎數據計算完整的損益表，包含營業收入、成本、費用、稅前淨利、稅後淨利等項目",
    "input_schema": {
        "type": "object",
        "properties": {
            "revenue": {
                "type": "number",
                "description": "營業收入（單位：元）"
            },
            "cost_of_goods_sold": {
                "type": "number",
                "description": "營業成本（單位：元）"
            },
            "operating_expenses": {
                "type": "number",
                "description": "營業費用（單位：元）"
            },
            "non_operating_income": {
                "type": "number",
                "description": "營業外收入（單位：元）"
            },
            "non_operating_expenses": {
                "type": "number",
                "description": "營業外支出（單位：元）"
            },
            "tax_rate": {
                "type": "number",
                "description": "所得稅率（0-1之間，例如0.2表示20%）"
            }
        },
        "required": ["revenue", "cost_of_goods_sold", "operating_expenses"]
    }
}

def calculate_income_statement(
    revenue: float,
    cost_of_goods_sold: float,
    operating_expenses: float,
    non_operating_income: float = 0,
    non_operating_expenses: float = 0,
    tax_rate: float = 0.2
):
    gross_profit = revenue - cost_of_goods_sold
    gross_profit_margin = (gross_profit / revenue * 100) if revenue > 0 else 0
    
    operating_income = gross_profit - operating_expenses
    operating_income_margin = (operating_income / revenue * 100) if revenue > 0 else 0
    
    pretax_income = operating_income + non_operating_income - non_operating_expenses
    income_tax = pretax_income * tax_rate if pretax_income > 0 else 0
    net_income = pretax_income - income_tax
    net_profit_margin = (net_income / revenue * 100) if revenue > 0 else 0
    
    return {
        "revenue": revenue,
        "cost_of_goods_sold": cost_of_goods_sold,
        "gross_profit": gross_profit,
        "gross_profit_margin": f"{gross_profit_margin:.2f}%",
        "operating_expenses": operating_expenses,
        "operating_income": operating_income,
        "operating_income_margin": f"{operating_income_margin:.2f}%",
        "non_operating_income": non_operating_income,
        "non_operating_expenses": non_operating_expenses,
        "pretax_income": pretax_income,
        "income_tax": income_tax,
        "tax_rate": f"{tax_rate * 100:.0f}%",
        "net_income": net_income,
        "net_profit_margin": f"{net_profit_margin:.2f}%",
        "warnings": _check_income_statement_health(
            gross_profit_margin, operating_income_margin, net_profit_margin
        )
    }

def _check_income_statement_health(gross_margin, operating_margin, net_margin):
    warnings = []
    if gross_margin < 20:
        warnings.append("毛利率偏低（<20%），成本控制可能有問題")
    if operating_margin < 10:
        warnings.append("營業利益率偏低（<10%），營運效率需改善")
    if net_margin < 5:
        warnings.append("淨利率偏低（<5%），整體獲利能力不佳")
    if operating_margin < 0:
        warnings.append("營業利益為負，本業虧損")
    if net_margin < 0:
        warnings.append("淨利為負，公司整體虧損")
    return warnings if warnings else ["損益表健康度良好"]


class ToolManager:
    def __init__(self):
        self.tools = {
            "calculate_roe": {
                "function": calculate_roe,
                "schema": calculate_roe_schema
            },
            "calculate_income_statement": {
                "schema": calculate_income_statement_schema,
                "function": calculate_income_statement
            }
        }
    
    def get_tool_schemas(self):
        return [tool["schema"] for tool in self.tools.values()]
    
    def execute_tool(self, tool_name: str, arguments: dict):
        if tool_name not in self.tools:
            return {"error": f"未知工具: {tool_name}"}
        
        try:
            tool_function = self.tools[tool_name]["function"]
            result = tool_function(**arguments)
            return result
        except Exception as e:
            return {"error": f"執行工具時發生錯誤: {str(e)}"}


# ===== 使用示例 =====
#if __name__ == "__main__":
    # 初始化助理（可選擇不同模型）
    #assistant = FinanceAssistantLocal(model_name="qwen3:8b")
    # 或使用: "qwen3:4b", "llama3.1:8b", "mistral:7b", "gemma2:9b"
    
    # 測試對話
    #response = assistant.chat(
    #    "幫我分析一下這個財報：營業收入 10,000,000，營業成本 6,000,000，"
    #    "營業費用 2,000,000，營業外收入 100,000，所得稅 400,000"
    #)
    
    #print("=" * 60)
    #print("🤖 助理回覆:")
    #print(response)