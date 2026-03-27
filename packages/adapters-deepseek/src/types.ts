export interface DeepSeekHistoryResponse {
  code: number;
  data?: {
    biz_data?: {
      chat_session?: {
        id?: string;
        title?: string;
        updated_at?: string;
      };
      chat_messages?: DeepSeekMessage[];
      chat_sessions?: DeepSeekSessionCandidate[];
      sessions?: DeepSeekSessionCandidate[];
    };
    items?: DeepSeekSessionCandidate[];
    list?: DeepSeekSessionCandidate[];
  };
  msg?: string;
}

export interface DeepSeekMessage {
  message_id?: number | string;
  parent_id?: number | string;
  role: string;
  content?: string;
  thinking_content?: string;
  inserted_at?: string | number;
  fragments?: Array<{
    id?: number | string;
    type?: string;
    content?: string;
  }>;
}

export interface DeepSeekSessionCandidate {
  id?: string;
  chat_session_id?: string;
  session_id?: string;
  title?: string;
  updated_at?: string | number;
  inserted_at?: string | number;
}
