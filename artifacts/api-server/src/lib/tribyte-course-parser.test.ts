import assert from "node:assert/strict";
import test from "node:test";
import { parseTriByteCoursePage } from "./tribyte-course-parser.ts";

test("parses a category carousel card without a redundant nid attribute", () => {
  const html = `
    <ul>
      <li id="category_484883" title="ME-GI Course">
        <a href="/reviewer/topics?cat=21287&catspec=true">
          <div class="carousel_image_element">
            <img src="https://static.learn.himtelearning.com/course.png?v=1" />
          </div>
        </a>
        <div class="clipping-title">
          <div class="carousel_title_element">ME-<strong>GI</strong> Course</div>
        </div>
        <ul><li class="menu-item">Nested card menu item</li></ul>
      </li>
    </ul>
  `;

  assert.deepEqual(parseTriByteCoursePage(html), [{
    nid: "484883",
    tid: "21287",
    name: "ME- GI Course",
    thumbUrl: "https://static.learn.himtelearning.com/course.png?v=1",
  }]);
});